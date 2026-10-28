-- Khushi Points: core schema.
-- Every shop's data is separated by shop_id. Tables are read through row level
-- security; all writes go through the functions below so the points rules
-- cannot be skipped from the browser.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.shops (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 80),
  slug             text not null unique,          -- public balance page: /b/<slug>
  join_code        text not null unique,          -- staff enter this to join the shop
  earn_pct         numeric(5,2)  not null default 2   check (earn_pct > 0 and earn_pct <= 50),
  point_value      numeric(8,2)  not null default 1   check (point_value > 0),
  min_bill         numeric(10,2) not null default 100 check (min_bill >= 0),
  min_redeem       int           not null default 50  check (min_redeem > 0),
  max_redeem_pct   int           not null default 50  check (max_redeem_pct between 1 and 100),
  expiry_days      int           not null default 365 check (expiry_days > 0),
  one_bill_per_day boolean       not null default true,
  timezone         text          not null default 'Asia/Kolkata',
  plan             text          not null default 'free' check (plan in ('free','basic','pro')),
  created_at       timestamptz   not null default now()
);

create table public.shop_members (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','cashier')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index on public.shop_members (user_id);

create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  mobile     text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  name       text not null default 'Customer' check (char_length(name) <= 80),
  pin_hash   text,
  pin_fails  int  not null default 0,
  consent_at timestamptz not null default now(),   -- DPDP Act: customer agreed at first bill
  created_at timestamptz not null default now(),
  unique (shop_id, mobile)
);

create table public.transactions (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        text not null check (kind in ('earn','redeem')),
  bill_no     text,
  amount      numeric(12,2) not null check (amount >= 0),
  points      int not null check (points > 0),
  method      text check (method in ('pin','otp')),     -- redeem only
  staff_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.transactions (shop_id, created_at desc);
create index on public.transactions (customer_id, created_at desc);
-- each bill number earns points once per shop
create unique index transactions_one_earn_per_bill
  on public.transactions (shop_id, upper(bill_no)) where kind = 'earn';

create table public.point_lots (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  points      int not null check (points > 0),
  points_left int not null check (points_left >= 0),
  earned_at   timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index on public.point_lots (customer_id, expires_at) where points_left > 0;

create table public.otp_codes (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  code_hash   text not null,
  tries       int  not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.otp_codes (customer_id, created_at desc);

-- SMS we sent. The OTP itself is never stored here.
create table public.sms_log (
  id           bigint generated always as identity primary key,
  shop_id      uuid not null references public.shops(id) on delete cascade,
  mobile       text not null,
  kind         text not null check (kind in ('otp','earn')),
  provider     text not null,
  status       text not null check (status in ('sent','failed','demo')),
  provider_ref text,
  created_at   timestamptz not null default now()
);
create index on public.sms_log (shop_id, created_at desc);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_member(p_shop uuid, p_owner_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shop_members
    where shop_id = p_shop and user_id = auth.uid()
      and (not p_owner_only or role = 'owner'));
$$;

create or replace function public._require_member(p_shop uuid, p_owner_only boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not is_member(p_shop, p_owner_only) then
    raise exception '%', case when p_owner_only then 'OWNER_ONLY' else 'NOT_A_MEMBER' end;
  end if;
end $$;

create or replace function public._clean_mobile(p text)
returns text language plpgsql immutable as $$
declare m text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if length(m) = 12 and left(m, 2) = '91' then m := substr(m, 3); end if;
  if m !~ '^[6-9][0-9]{9}$' then raise exception 'BAD_MOBILE'; end if;
  return m;
end $$;

create or replace function public._balance(p_customer uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(points_left), 0)::int from point_lots
  where customer_id = p_customer and points_left > 0 and expires_at > now();
$$;

create or replace function public._random_code(p_len int, p_alphabet text)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare r text := ''; b bytea := gen_random_bytes(p_len);
begin
  for i in 0 .. p_len - 1 loop
    r := r || substr(p_alphabet, 1 + (get_byte(b, i) % length(p_alphabet)), 1);
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------- shops & staff

create or replace function public.create_shop(p_name text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s shops; base text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if (select count(*) from shop_members where user_id = auth.uid() and role = 'owner') >= 5 then
    raise exception 'TOO_MANY_SHOPS';
  end if;
  base := trim(both '-' from left(regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '-', 'g'), 30));
  if base = '' then base := 'shop'; end if;
  insert into shops (name, slug, join_code)
  values (trim(p_name),
          base || '-' || _random_code(4, 'abcdefghjkmnpqrstuvwxyz23456789'),
          _random_code(6, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'))
  returning * into s;
  insert into shop_members (shop_id, user_id, role) values (s.id, auth.uid(), 'owner');
  return s;
end $$;

create or replace function public.join_shop(p_code text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into s from shops where join_code = upper(trim(p_code));
  if not found then raise exception 'BAD_JOIN_CODE'; end if;
  insert into shop_members (shop_id, user_id, role) values (s.id, auth.uid(), 'cashier')
  on conflict do nothing;
  return s;
end $$;

create or replace function public.new_join_code(p_shop uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform _require_member(p_shop, true);
  c := _random_code(6, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  update shops set join_code = c where id = p_shop;
  return c;
end $$;

create or replace function public.list_staff(p_shop uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  return query
    select m.user_id, u.email::text, m.role, m.created_at
    from shop_members m join auth.users u on u.id = m.user_id
    where m.shop_id = p_shop order by m.created_at;
end $$;

create or replace function public.remove_staff(p_shop uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  if p_user = auth.uid() then raise exception 'CANNOT_REMOVE_SELF'; end if;
  delete from shop_members where shop_id = p_shop and user_id = p_user and role = 'cashier';
end $$;

create or replace function public.update_shop_settings(p_shop uuid, p jsonb)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  update shops set
    name             = coalesce(nullif(trim(p->>'name'), ''), name),
    earn_pct         = coalesce((p->>'earn_pct')::numeric, earn_pct),
    point_value      = coalesce((p->>'point_value')::numeric, point_value),
    min_bill         = coalesce((p->>'min_bill')::numeric, min_bill),
    min_redeem       = coalesce((p->>'min_redeem')::int, min_redeem),
    max_redeem_pct   = coalesce((p->>'max_redeem_pct')::int, max_redeem_pct),
    expiry_days      = coalesce((p->>'expiry_days')::int, expiry_days),
    one_bill_per_day = coalesce((p->>'one_bill_per_day')::boolean, one_bill_per_day)
  where id = p_shop returning * into s;
  return s;
end $$;

-- ---------------------------------------------------------------- earning

create or replace function public.add_bill(
  p_shop uuid, p_mobile text, p_bill_no text, p_amount numeric,
  p_name text default null, p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; c customers; m text; pts int; is_new boolean := false; bill text;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  m := _clean_mobile(p_mobile);
  bill := upper(trim(coalesce(p_bill_no, '')));
  if bill = '' then raise exception 'BILL_NO_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_amount < s.min_bill then raise exception 'BELOW_MIN_BILL'; end if;

  select * into c from customers where shop_id = p_shop and mobile = m for update;
  if not found then
    if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
    insert into customers (shop_id, mobile, name)
    values (p_shop, m, coalesce(nullif(trim(p_name), ''), 'Customer'))
    on conflict (shop_id, mobile) do nothing;
    select * into c from customers where shop_id = p_shop and mobile = m for update;
    is_new := true;
  end if;

  if exists (select 1 from transactions where shop_id = p_shop and kind = 'earn' and upper(bill_no) = bill) then
    raise exception 'BILL_ALREADY_USED';
  end if;
  if s.one_bill_per_day and exists (
      select 1 from transactions
      where customer_id = c.id and kind = 'earn'
        and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date) then
    raise exception 'ALREADY_EARNED_TODAY';
  end if;

  pts := floor(p_amount * s.earn_pct / 100 / s.point_value);
  if pts < 1 then raise exception 'TOO_SMALL_FOR_POINTS'; end if;

  insert into transactions (shop_id, customer_id, kind, bill_no, amount, points, staff_id)
  values (p_shop, c.id, 'earn', bill, p_amount, pts, auth.uid());
  insert into point_lots (shop_id, customer_id, points, points_left, expires_at)
  values (p_shop, c.id, pts, pts, now() + make_interval(days => s.expiry_days));

  return jsonb_build_object('points', pts, 'balance', _balance(c.id),
    'value', _balance(c.id) * s.point_value, 'name', c.name, 'is_new', is_new);
end $$;

-- ---------------------------------------------------------------- balance

create or replace function public.customer_balance(p_shop uuid, p_mobile text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; c customers; m text;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  m := _clean_mobile(p_mobile);
  select * into c from customers where shop_id = p_shop and mobile = m;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object(
    'exists', true, 'name', c.name, 'mobile', c.mobile,
    'balance', _balance(c.id),
    'value', _balance(c.id) * s.point_value,
    'expiring_30d', (select coalesce(sum(points_left),0) from point_lots
                     where customer_id = c.id and points_left > 0
                       and expires_at > now() and expires_at <= now() + interval '30 days'),
    'has_pin', c.pin_hash is not null,
    'pin_locked', c.pin_hash is not null and c.pin_fails >= 3,
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (
        select kind, bill_no, amount, points, method, created_at from transactions
        where customer_id = c.id order by created_at desc limit 5) t), '[]'::jsonb));
end $$;

-- Public page: shows points only (no name), so a guessed number reveals little.
create or replace function public.public_balance(p_slug text, p_mobile text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; c customers; m text;
begin
  select * into s from shops where slug = lower(trim(p_slug));
  if not found then return null; end if;
  begin m := _clean_mobile(p_mobile); exception when others then return jsonb_build_object('shop', s.name, 'error', 'BAD_MOBILE'); end;
  select * into c from customers where shop_id = s.id and mobile = m;
  return jsonb_build_object('shop', s.name,
    'points', case when c.id is null then 0 else _balance(c.id) end,
    'value',  case when c.id is null then 0 else _balance(c.id) * s.point_value end,
    'min_redeem', s.min_redeem);
end $$;

create or replace function public.public_shop(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('shop', name, 'earn_pct', earn_pct, 'point_value', point_value, 'min_redeem', min_redeem)
  from shops where slug = lower(trim(p_slug));
$$;

-- ---------------------------------------------------------------- redeeming

-- Shared by both verification paths. Caller has already verified the customer.
create or replace function public._do_redeem(
  p_shop uuid, p_customer uuid, p_bill_amount numeric, p_points int, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops; bal int; cap int; left_to_take int := p_points; l record; take int;
begin
  select * into s from shops where id = p_shop;
  if p_bill_amount is null or p_bill_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_points is null or p_points < s.min_redeem then raise exception 'BELOW_MIN_REDEEM'; end if;
  bal := _balance(p_customer);
  if p_points > bal then raise exception 'NOT_ENOUGH_POINTS'; end if;
  cap := floor(p_bill_amount * s.max_redeem_pct / 100 / s.point_value);
  if p_points > cap then raise exception 'OVER_MAX_DISCOUNT'; end if;

  -- oldest points first
  for l in select id, points_left from point_lots
           where customer_id = p_customer and points_left > 0 and expires_at > now()
           order by expires_at, id for update loop
    take := least(l.points_left, left_to_take);
    update point_lots set points_left = points_left - take where id = l.id;
    left_to_take := left_to_take - take;
    exit when left_to_take = 0;
  end loop;

  insert into transactions (shop_id, customer_id, kind, amount, points, method, staff_id)
  values (p_shop, p_customer, 'redeem', p_bill_amount, p_points, p_method, auth.uid());

  return jsonb_build_object('ok', true, 'points', p_points,
    'discount', p_points * s.point_value,
    'pay', p_bill_amount - p_points * s.point_value,
    'balance', _balance(p_customer), 'method', p_method);
end $$;

create or replace function public._check_new_pin(p_pin text)
returns void language plpgsql immutable as $$
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN_FORMAT'; end if;
  if p_pin in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
               '1234','4321','1212','2580','0123','9876','1122','6789') then
    raise exception 'PIN_TOO_EASY';
  end if;
end $$;

-- Wrong PIN returns ok=false (not an exception) so the failed-try count is saved.
create or replace function public.redeem_with_pin(
  p_shop uuid, p_mobile text, p_bill_amount numeric, p_points int, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c customers;
begin
  perform _require_member(p_shop);
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile) for update;
  if not found then raise exception 'NO_CUSTOMER'; end if;
  if c.pin_hash is null then raise exception 'NO_PIN'; end if;
  if c.pin_fails >= 3 then return jsonb_build_object('ok', false, 'error', 'PIN_LOCKED'); end if;
  if crypt(coalesce(p_pin,''), c.pin_hash) <> c.pin_hash then
    update customers set pin_fails = pin_fails + 1 where id = c.id;
    return jsonb_build_object('ok', false,
      'error', case when c.pin_fails + 1 >= 3 then 'PIN_LOCKED' else 'WRONG_PIN' end,
      'tries_left', greatest(0, 2 - c.pin_fails));
  end if;
  update customers set pin_fails = 0 where id = c.id;
  return _do_redeem(p_shop, c.id, p_bill_amount, p_points, 'pin');
end $$;

-- Called only by the send-otp server function (service role). Never returns
-- the code to shop staff, so a cashier cannot redeem without the customer's phone.
create or replace function public.create_otp(p_shop uuid, p_mobile text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c customers; code text; recent int;
begin
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile);
  if not found then raise exception 'NO_CUSTOMER'; end if;
  select count(*) into recent from otp_codes where customer_id = c.id and created_at > now() - interval '15 minutes';
  if recent >= 3 then raise exception 'OTP_RATE_LIMIT'; end if;
  select count(*) into recent from otp_codes where shop_id = p_shop and created_at > now() - interval '1 day';
  if recent >= 300 then raise exception 'SHOP_OTP_DAILY_LIMIT'; end if;
  code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  -- a new code replaces any older unused one
  update otp_codes set used_at = now() where customer_id = c.id and used_at is null;
  insert into otp_codes (shop_id, customer_id, code_hash, expires_at)
  values (p_shop, c.id, crypt(code, gen_salt('bf', 6)), now() + interval '5 minutes');
  return jsonb_build_object('code', code, 'mobile', c.mobile,
    'shop', (select name from shops where id = p_shop));
end $$;

-- Verifies the OTP, optionally sets a new PIN (this also unlocks a locked PIN), then redeems.
create or replace function public.redeem_with_otp(
  p_shop uuid, p_mobile text, p_bill_amount numeric, p_points int, p_otp text, p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c customers; o otp_codes;
begin
  perform _require_member(p_shop);
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile) for update;
  if not found then raise exception 'NO_CUSTOMER'; end if;
  if p_new_pin is not null and p_new_pin <> '' then perform _check_new_pin(p_new_pin); end if;

  select * into o from otp_codes
  where customer_id = c.id and used_at is null and expires_at > now()
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;
  if o.tries >= 3 then return jsonb_build_object('ok', false, 'error', 'OTP_TOO_MANY_TRIES'); end if;
  if crypt(coalesce(p_otp,''), o.code_hash) <> o.code_hash then
    update otp_codes set tries = tries + 1, used_at = case when tries + 1 >= 3 then now() end where id = o.id;
    return jsonb_build_object('ok', false,
      'error', case when o.tries + 1 >= 3 then 'OTP_TOO_MANY_TRIES' else 'WRONG_OTP' end,
      'tries_left', greatest(0, 2 - o.tries));
  end if;

  update otp_codes set used_at = now() where id = o.id;
  update customers set pin_fails = 0,
    pin_hash = case when p_new_pin is not null and p_new_pin <> '' then crypt(p_new_pin, gen_salt('bf', 8)) else pin_hash end
  where id = c.id;
  return _do_redeem(p_shop, c.id, p_bill_amount, p_points, 'otp')
         || jsonb_build_object('pin_set', p_new_pin is not null and p_new_pin <> '');
end $$;

-- ---------------------------------------------------------------- owner tools

create or replace function public.shop_dashboard(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  select * into s from shops where id = p_shop;
  return jsonb_build_object(
    'customers',      (select count(*) from customers where shop_id = p_shop),
    'customers_pin',  (select count(*) from customers where shop_id = p_shop and pin_hash is not null),
    'bills_30d',      (select count(*) from transactions where shop_id = p_shop and kind='earn' and created_at > now() - interval '30 days'),
    'sales_30d',      (select coalesce(sum(amount),0) from transactions where shop_id = p_shop and kind='earn' and created_at > now() - interval '30 days'),
    'points_given',   (select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='earn'),
    'points_redeemed',(select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='redeem'),
    'redeems_pin',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='pin'),
    'redeems_otp',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='otp'),
    'points_owed',    (select coalesce(sum(points_left),0) from point_lots where shop_id = p_shop and points_left > 0 and expires_at > now()),
    'point_value',    s.point_value,
    'sms_30d',        (select count(*) from sms_log where shop_id = p_shop and created_at > now() - interval '30 days'),
    'sms_total',      (select count(*) from sms_log where shop_id = p_shop));
end $$;

create or replace function public.list_customers(p_shop uuid, p_search text default null)
returns table (mobile text, name text, balance int, visits bigint, has_pin boolean, pin_locked boolean, last_visit timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
    select c.mobile, c.name, _balance(c.id),
           (select count(*) from transactions t where t.customer_id = c.id and t.kind = 'earn'),
           c.pin_hash is not null, c.pin_hash is not null and c.pin_fails >= 3,
           (select max(created_at) from transactions t where t.customer_id = c.id)
    from customers c
    where c.shop_id = p_shop
      and (p_search is null or p_search = '' or c.name ilike '%' || p_search || '%'
           or c.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    order by 7 desc nulls last
    limit 200;
end $$;

create or replace function public.recent_activity(p_shop uuid, p_limit int default 50)
returns table (created_at timestamptz, kind text, name text, mobile text, bill_no text, amount numeric, points int, method text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
    select t.created_at, t.kind, c.name, c.mobile, t.bill_no, t.amount, t.points, t.method
    from transactions t join customers c on c.id = t.customer_id
    where t.shop_id = p_shop order by t.created_at desc limit least(p_limit, 200);
end $$;

-- DPDP Act: delete a customer's data on request.
create or replace function public.delete_customer(p_shop uuid, p_mobile text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  delete from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile);
end $$;

create or replace function public.log_sms(p_shop uuid, p_mobile text, p_kind text, p_provider text, p_status text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into sms_log (shop_id, mobile, kind, provider, status, provider_ref)
  values (p_shop, p_mobile, p_kind, p_provider, p_status, p_ref);
$$;

-- ---------------------------------------------------------------- row level security
-- Staff can read their own shops' rows. No direct writes: use the functions.

alter table public.shops        enable row level security;
alter table public.shop_members enable row level security;
alter table public.customers    enable row level security;
alter table public.transactions enable row level security;
alter table public.point_lots   enable row level security;
alter table public.otp_codes    enable row level security;
alter table public.sms_log      enable row level security;

create policy "members read shop"   on public.shops        for select to authenticated using (is_member(id));
create policy "members read members" on public.shop_members for select to authenticated using (is_member(shop_id));
create policy "members read customers" on public.customers for select to authenticated using (is_member(shop_id));
create policy "members read txns"   on public.transactions for select to authenticated using (is_member(shop_id));
create policy "members read lots"   on public.point_lots   for select to authenticated using (is_member(shop_id));
create policy "owners read sms log" on public.sms_log      for select to authenticated using (is_member(shop_id, true));
-- otp_codes: no policy, nobody reads it directly.

-- PIN hashes stay hidden even from staff.
revoke select on public.customers from authenticated, anon;
grant select (id, shop_id, mobile, name, pin_fails, consent_at, created_at) on public.customers to authenticated;

-- ---------------------------------------------------------------- function access

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_member(uuid, boolean),
  public.create_shop(text), public.join_shop(text), public.new_join_code(uuid),
  public.list_staff(uuid), public.remove_staff(uuid, uuid), public.update_shop_settings(uuid, jsonb),
  public.add_bill(uuid, text, text, numeric, text, boolean),
  public.customer_balance(uuid, text),
  public.redeem_with_pin(uuid, text, numeric, int, text),
  public.redeem_with_otp(uuid, text, numeric, int, text, text),
  public.shop_dashboard(uuid), public.list_customers(uuid, text), public.recent_activity(uuid, int),
  public.delete_customer(uuid, text)
to authenticated;

grant execute on function public.public_balance(text, text), public.public_shop(text) to anon, authenticated;

grant execute on function public.create_otp(uuid, text), public.log_sms(uuid, text, text, text, text, text),
  public.is_member(uuid, boolean) to service_role;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
