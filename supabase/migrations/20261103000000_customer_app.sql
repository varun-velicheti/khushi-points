-- Customer app: one account for all shops, member QR, follows, offers,
-- approve-to-redeem in the app, receipts, shop profiles, expired history.
-- No SMS or WhatsApp to shoppers. Points stay per shop.

-- ---------------------------------------------------------------- tables

create table public.app_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text check (char_length(name) <= 60),
  phone       text unique check (phone ~ '^[6-9][0-9]{9}$'),   -- verified in the app, optional
  member_code text not null unique,                             -- shown as QR at the counter
  created_at  timestamptz not null default now()
);

-- A shop's customer can be known by mobile number, by app account, or both.
alter table public.customers alter column mobile drop not null;
alter table public.customers add column app_user_id uuid references auth.users(id) on delete set null;
alter table public.customers add constraint customers_has_identity check (mobile is not null or app_user_id is not null);
create unique index customers_one_per_app_user on public.customers (shop_id, app_user_id) where app_user_id is not null;

-- Shop profile shown in the customer app.
alter table public.shops
  add column category text check (category in ('restaurant','cafe','bakery','sweets','icecream','grocery','supermarket',
                                               'clothing','salon','pharmacy','electronics','other')),
  add column about text check (char_length(about) <= 300),
  add column address text check (char_length(address) <= 200),
  add column area text check (char_length(area) <= 60),
  add column city text check (char_length(city) <= 60),
  add column contact_phone text check (contact_phone ~ '^[0-9+ -]{6,16}$'),
  add column hours text check (char_length(hours) <= 80),
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);

create table public.shop_follows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  shop_id    uuid not null references public.shops(id) on delete cascade,
  following  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text check (platform in ('ios','android','web')),
  updated_at timestamptz not null default now()
);
create index on public.push_tokens (user_id);

create table public.offers (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  title       text not null check (char_length(title) between 3 and 80),
  body        text not null default '' check (char_length(body) <= 300),
  valid_until date,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  recipients  int not null default 0
);
create index on public.offers (shop_id, created_at desc);

create table public.redeem_requests (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  bill_amount numeric(12,2) not null check (bill_amount > 0),
  points      int not null check (points > 0),
  status      text not null default 'pending' check (status in ('pending','done','declined','expired','cancelled','failed')),
  error       text,
  txn_id      bigint references public.transactions(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '2 minutes',
  decided_at  timestamptz
);
create index on public.redeem_requests (user_id, created_at desc);

-- Phone sign-in codes for the customer app (used only by the server function).
create table public.app_login_codes (
  id           bigint generated always as identity primary key,
  phone        text not null,
  code_hash    text,
  provider_ref text,
  tries        int not null default 0,
  expires_at   timestamptz not null default now() + interval '5 minutes',
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.app_login_codes (phone, created_at desc);

-- Receipt text on a bill ("2 Chicken Biryani, 1 Coke"), and redemptions approved in the app.
alter table public.transactions add column note text check (char_length(note) <= 300);
alter table public.transactions drop constraint transactions_method_check;
alter table public.transactions add constraint transactions_method_check check (method in ('pin','otp','app'));

alter table public.app_users       enable row level security;
alter table public.shop_follows    enable row level security;
alter table public.push_tokens     enable row level security;
alter table public.offers          enable row level security;
alter table public.redeem_requests enable row level security;
alter table public.app_login_codes enable row level security;
create policy "members read offers" on public.offers for select to authenticated using (is_member(shop_id));

-- ---------------------------------------------------------------- helpers

create or replace function public._me_app()
returns public.app_users language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into u from app_users where user_id = auth.uid();
  if not found then
    insert into app_users (user_id, member_code)
    values (auth.uid(), 'K' || _random_code(7, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'))
    on conflict (user_id) do nothing;
    select * into u from app_users where user_id = auth.uid();
  end if;
  return u;
end $$;

-- Links every shop record with this phone to the app account, and follows those shops.
create or replace function public._link_phone(p_user uuid, p_phone text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_phone is null then return 0; end if;
  with linked as (
    update customers set app_user_id = p_user
    where mobile = p_phone and app_user_id is null
      and not exists (select 1 from customers c2 where c2.shop_id = customers.shop_id and c2.app_user_id = p_user)
    returning shop_id)
  insert into shop_follows (user_id, shop_id)
  select p_user, shop_id from linked on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Finds (and optionally creates) the shop's customer from a mobile number or an app member code.
create or replace function public._customer_for(
  p_shop uuid, p_mobile text, p_member text, p_name text, p_consent boolean, p_create boolean)
returns public.customers language plpgsql security definer set search_path = public as $$
declare c customers; u app_users; m text;
begin
  if nullif(trim(coalesce(p_member, '')), '') is not null then
    select * into u from app_users
    where member_code = upper(regexp_replace(trim(p_member), '^KP:', '', 'i'));
    if not found then raise exception 'BAD_MEMBER_CODE'; end if;
    select * into c from customers
    where shop_id = p_shop and (app_user_id = u.user_id or (u.phone is not null and mobile = u.phone))
    order by (app_user_id = u.user_id) desc nulls last limit 1 for update;
    if found then
      if c.app_user_id is null then
        update customers set app_user_id = u.user_id where id = c.id returning * into c;
      end if;
    elsif p_create then
      -- the customer agreed to the app's terms, so no separate consent tick is needed
      insert into customers (shop_id, mobile, name, app_user_id)
      values (p_shop, u.phone, coalesce(nullif(trim(p_name), ''), u.name, 'Customer'), u.user_id)
      returning * into c;
    else
      return null;
    end if;
    insert into shop_follows (user_id, shop_id) values (u.user_id, p_shop) on conflict do nothing;
    return c;
  end if;

  m := _clean_mobile(p_mobile);
  select * into c from customers where shop_id = p_shop and mobile = m for update;
  if not found then
    if not p_create then return null; end if;
    if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
    insert into customers (shop_id, mobile, name) values (p_shop, m, coalesce(nullif(trim(p_name), ''), 'Customer'))
    on conflict (shop_id, mobile) do nothing;
    select * into c from customers where shop_id = p_shop and mobile = m for update;
  end if;
  -- someone with the app already verified this number: connect them
  if c.app_user_id is null then
    select * into u from app_users where phone = m;
    if found and not exists (select 1 from customers where shop_id = p_shop and app_user_id = u.user_id) then
      update customers set app_user_id = u.user_id where id = c.id returning * into c;
      insert into shop_follows (user_id, shop_id) values (u.user_id, p_shop) on conflict do nothing;
    end if;
  end if;
  return c;
end $$;

-- ---------------------------------------------------------------- counter: earning (bill number optional, receipt note, member QR)

drop function if exists public.add_bill(uuid, text, text, numeric, text, boolean);
create function public.add_bill(
  p_shop uuid, p_mobile text default null, p_bill_no text default null, p_amount numeric default null,
  p_name text default null, p_consent boolean default false, p_member text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; c customers; pts int; is_new boolean; bill text;
  today_pts int := 0; today_max numeric := 0; award int; v_txn bigint;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  bill := nullif(upper(trim(coalesce(p_bill_no, ''))), '');
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_amount < s.min_bill then raise exception 'BELOW_MIN_BILL'; end if;

  c := _customer_for(p_shop, p_mobile, p_member, p_name, p_consent, false);
  is_new := c.id is null;
  if is_new then c := _customer_for(p_shop, p_mobile, p_member, p_name, p_consent, true); end if;

  if bill is not null and exists (select 1 from transactions where shop_id = p_shop and kind = 'earn'
                                  and reversed_at is null and upper(bill_no) = bill) then
    raise exception 'BILL_ALREADY_USED';
  end if;

  pts := floor(p_amount * s.earn_pct / 100 / s.point_value);
  if pts < 1 then raise exception 'TOO_SMALL_FOR_POINTS'; end if;
  award := pts;

  if s.one_bill_per_day then
    select coalesce(sum(points), 0), coalesce(max(amount), 0) into today_pts, today_max
    from transactions
    where customer_id = c.id and kind = 'earn' and reversed_at is null
      and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
    if today_pts > 0 then
      if p_amount <= today_max then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
      award := pts - today_pts;
      if award < 1 then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
    end if;
  end if;

  insert into transactions (shop_id, customer_id, kind, bill_no, amount, points, staff_id, note)
  values (p_shop, c.id, 'earn', bill, p_amount, award, auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_txn;
  insert into point_lots (shop_id, customer_id, points, points_left, expires_at, txn_id)
  values (p_shop, c.id, award, award, now() + make_interval(days => s.expiry_days), v_txn);

  return jsonb_build_object('txn_id', v_txn, 'points', award, 'bill_points', pts,
    'topped_up', today_pts > 0, 'earlier_today', today_pts, 'earlier_bill', today_max,
    'balance', _balance(c.id), 'value', _balance(c.id) * s.point_value,
    'name', c.name, 'is_new', is_new, 'has_app', c.app_user_id is not null);
end $$;

-- Balance lookup by number or member QR.
drop function if exists public.customer_balance(uuid, text);
create function public.customer_balance(p_shop uuid, p_mobile text default null, p_member text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; c customers; m text; u app_users;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  if nullif(trim(coalesce(p_member, '')), '') is not null then
    select * into u from app_users where member_code = upper(regexp_replace(trim(p_member), '^KP:', '', 'i'));
    if not found then raise exception 'BAD_MEMBER_CODE'; end if;
    select * into c from customers where shop_id = p_shop and (app_user_id = u.user_id or (u.phone is not null and mobile = u.phone))
    order by (app_user_id = u.user_id) desc nulls last limit 1;
    if not found then return jsonb_build_object('exists', false, 'has_app', true, 'name', u.name); end if;
  else
    m := _clean_mobile(p_mobile);
    select * into c from customers where shop_id = p_shop and mobile = m;
    if not found then
      return jsonb_build_object('exists', false, 'has_app', exists (select 1 from app_users where phone = m));
    end if;
  end if;
  return jsonb_build_object(
    'exists', true, 'name', c.name, 'mobile', c.mobile,
    'has_app', c.app_user_id is not null or exists (select 1 from app_users where phone = c.mobile),
    'balance', _balance(c.id),
    'value', _balance(c.id) * s.point_value,
    'expiring_30d', (select coalesce(sum(points_left),0) from point_lots
                     where customer_id = c.id and points_left > 0
                       and expires_at > now() and expires_at <= now() + interval '30 days'),
    'has_pin', c.pin_hash is not null,
    'pin_locked', c.pin_hash is not null and c.pin_fails >= 3,
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (
        select kind, bill_no, amount, points, method, created_at, reversed_at is not null as undone, note
        from transactions where customer_id = c.id order by created_at desc limit 5) t), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- counter: redeem by approval in the app

create or replace function public.start_redemption(
  p_shop uuid, p_mobile text default null, p_member text default null, p_bill_amount numeric default null, p_points int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops; c customers; bal int; cap int; r redeem_requests;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  c := _customer_for(p_shop, p_mobile, p_member, null, false, false);
  if c.id is null then raise exception 'NO_CUSTOMER'; end if;
  if c.app_user_id is null then raise exception 'NEEDS_APP'; end if;
  if p_bill_amount is null or p_bill_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_points is null or p_points < s.min_redeem then raise exception 'BELOW_MIN_REDEEM'; end if;
  bal := _balance(c.id);
  if p_points > bal then raise exception 'NOT_ENOUGH_POINTS'; end if;
  cap := floor(p_bill_amount * s.max_redeem_pct / 100 / s.point_value);
  if p_points > cap then raise exception 'OVER_MAX_DISCOUNT'; end if;

  update redeem_requests set status = 'cancelled', decided_at = now()
  where customer_id = c.id and status = 'pending';
  insert into redeem_requests (shop_id, customer_id, user_id, bill_amount, points, created_by)
  values (p_shop, c.id, c.app_user_id, p_bill_amount, p_points, auth.uid())
  returning * into r;
  return jsonb_build_object('request_id', r.id, 'name', c.name, 'points', r.points,
    'discount', r.points * s.point_value, 'expires_at', r.expires_at);
end $$;

create or replace function public.redemption_status(p_shop uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r redeem_requests; s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  update redeem_requests set status = 'expired' where id = p_request and status = 'pending' and expires_at <= now();
  select * into r from redeem_requests where id = p_request and shop_id = p_shop;
  if not found then raise exception 'NO_REQUEST'; end if;
  return jsonb_build_object('status', r.status, 'error', r.error, 'txn_id', r.txn_id, 'points', r.points,
    'discount', r.points * s.point_value, 'pay', r.bill_amount - r.points * s.point_value,
    'balance', (select _balance(r.customer_id)), 'expires_at', r.expires_at);
end $$;

create or replace function public.cancel_redemption(p_shop uuid, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  update redeem_requests set status = 'cancelled', decided_at = now()
  where id = p_request and shop_id = p_shop and status = 'pending';
end $$;

-- ---------------------------------------------------------------- counter: offers (owner, max 2 per 7 days)

create or replace function public.send_offer(p_shop uuid, p_title text, p_body text default '', p_valid_until date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o offers; recent int; followers int;
begin
  perform _require_member(p_shop, true);
  select count(*) into recent from offers where shop_id = p_shop and created_at > now() - interval '7 days';
  if recent >= 2 then raise exception 'OFFER_LIMIT'; end if;
  if p_valid_until is not null and p_valid_until < current_date then raise exception 'BAD_DATE'; end if;
  select count(*) into followers from shop_follows where shop_id = p_shop and following;
  insert into offers (shop_id, title, body, valid_until, created_by, recipients)
  values (p_shop, trim(p_title), trim(coalesce(p_body, '')), p_valid_until, auth.uid(), followers)
  returning * into o;
  return jsonb_build_object('offer_id', o.id, 'followers', followers,
    'next_allowed', (select min(created_at) + interval '7 days' from (
       select created_at from offers where shop_id = p_shop order by created_at desc limit 2) x
       having count(*) >= 2));
end $$;

create or replace function public.shop_offers(p_shop uuid)
returns table (id bigint, title text, body text, valid_until date, created_at timestamptz, recipients int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query select o.id, o.title, o.body, o.valid_until, o.created_at, o.recipients
  from offers o where o.shop_id = p_shop order by o.created_at desc limit 20;
end $$;

-- Profile and rules in one save (owner only).
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
    one_bill_per_day = coalesce((p->>'one_bill_per_day')::boolean, one_bill_per_day),
    category         = case when p ? 'category' then nullif(p->>'category', '') else category end,
    about            = case when p ? 'about' then nullif(trim(p->>'about'), '') else about end,
    address          = case when p ? 'address' then nullif(trim(p->>'address'), '') else address end,
    area             = case when p ? 'area' then nullif(trim(p->>'area'), '') else area end,
    city             = case when p ? 'city' then nullif(trim(p->>'city'), '') else city end,
    contact_phone    = case when p ? 'contact_phone' then nullif(trim(p->>'contact_phone'), '') else contact_phone end,
    hours            = case when p ? 'hours' then nullif(trim(p->>'hours'), '') else hours end,
    lat              = case when p ? 'lat' then (nullif(p->>'lat', ''))::double precision else lat end,
    lng              = case when p ? 'lng' then (nullif(p->>'lng', ''))::double precision else lng end
  where id = p_shop returning * into s;
  return s;
end $$;

-- Dashboard with repeat-customer numbers.
create or replace function public.shop_dashboard(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  select * into s from shops where id = p_shop;
  return jsonb_build_object(
    'customers',      (select count(*) from customers where shop_id = p_shop),
    'customers_pin',  (select count(*) from customers where shop_id = p_shop and pin_hash is not null),
    'customers_app',  (select count(*) from customers where shop_id = p_shop and app_user_id is not null),
    'followers',      (select count(*) from shop_follows where shop_id = p_shop and following),
    'bills_30d',      (select count(*) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'sales_30d',      (select coalesce(sum(amount),0) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'active_30d',     (select count(distinct customer_id) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'repeat_30d',     (select count(*) from (select customer_id from transactions where shop_id = p_shop and kind='earn' and reversed_at is null
                         and created_at > now() - interval '30 days' group by customer_id
                         having count(distinct (created_at at time zone s.timezone)::date) >= 2) x),
    'lapsed',         (select count(*) from (select customer_id, max(created_at) last from transactions where shop_id = p_shop and reversed_at is null
                         group by customer_id) x where last < now() - interval '30 days' and last > now() - interval '120 days'),
    'points_given',   (select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null),
    'points_redeemed',(select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='redeem' and reversed_at is null),
    'points_expired', (select coalesce(sum(points_left),0) from point_lots where shop_id = p_shop and points_left > 0 and expires_at <= now()),
    'redeems_pin',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method in ('pin','app') and reversed_at is null),
    'redeems_otp',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='otp' and reversed_at is null),
    'redeems_app',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='app' and reversed_at is null),
    'points_owed',    (select coalesce(sum(points_left),0) from point_lots where shop_id = p_shop and points_left > 0 and expires_at > now()),
    'point_value',    s.point_value,
    'offers_7d',      (select count(*) from offers where shop_id = p_shop and created_at > now() - interval '7 days'),
    'sms_30d',        (select count(*) from sms_log where shop_id = p_shop and created_at > now() - interval '30 days'),
    'sms_total',      (select count(*) from sms_log where shop_id = p_shop));
end $$;

-- ---------------------------------------------------------------- customer app

create or replace function public.app_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _me_app();
  perform _link_phone(u.user_id, u.phone);
  return jsonb_build_object('name', u.name, 'phone', u.phone, 'member_code', u.member_code,
    'email', (select email from auth.users where id = u.user_id));
end $$;

create or replace function public.app_set_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  update app_users set name = nullif(trim(p_name), '') where user_id = auth.uid();
end $$;

create or replace function public.app_wallet()
returns table (shop_id uuid, name text, category text, area text, city text, points int, value numeric,
               expiring_30d int, last_visit timestamptz, following boolean, latest_offer text, latest_offer_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _me_app();
  perform _link_phone(u.user_id, u.phone);
  return query
  select s.id, s.name, s.category, s.area, s.city, _balance(c.id), _balance(c.id) * s.point_value,
    (select coalesce(sum(l.points_left),0)::int from point_lots l where l.customer_id = c.id and l.points_left > 0
       and l.expires_at > now() and l.expires_at <= now() + interval '30 days'),
    (select max(t.created_at) from transactions t where t.customer_id = c.id and t.reversed_at is null),
    coalesce((select f.following from shop_follows f where f.user_id = u.user_id and f.shop_id = s.id), false),
    (select o.title from offers o where o.shop_id = s.id and (o.valid_until is null or o.valid_until >= current_date)
       order by o.created_at desc limit 1),
    (select o.created_at from offers o where o.shop_id = s.id and (o.valid_until is null or o.valid_until >= current_date)
       order by o.created_at desc limit 1)
  from customers c join shops s on s.id = c.shop_id
  where c.app_user_id = u.user_id
  order by 9 desc nulls last;
end $$;

create or replace function public.app_shop(p_shop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; s shops; c customers;
begin
  u := _me_app();
  select * into s from shops where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
  select * into c from customers where shop_id = p_shop and app_user_id = u.user_id;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'about', s.about, 'address', s.address,
      'area', s.area, 'city', s.city, 'contact_phone', s.contact_phone, 'hours', s.hours, 'lat', s.lat, 'lng', s.lng,
      'earn_pct', s.earn_pct, 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct,
      'expiry_days', s.expiry_days),
    'following', coalesce((select following from shop_follows where user_id = u.user_id and shop_id = p_shop), false),
    'points', case when c.id is null then 0 else _balance(c.id) end,
    'value', case when c.id is null then 0 else _balance(c.id) * s.point_value end,
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('points', l.points_left, 'expires_at', l.expires_at) order by l.expires_at)
       from point_lots l where c.id is not null and l.customer_id = c.id and l.points_left > 0
         and l.expires_at > now() and l.expires_at <= now() + interval '30 days'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by h.at desc) from (
        select t.kind, t.points, t.amount, t.bill_no, t.note, t.created_at as at, t.reversed_at is not null as undone
        from transactions t where c.id is not null and t.customer_id = c.id
        union all
        select 'expired', l.points_left, null, null, null, l.expires_at, false
        from point_lots l where c.id is not null and l.customer_id = c.id and l.points_left > 0 and l.expires_at <= now()
        order by 6 desc limit 50) h), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'body', o.body,
        'valid_until', o.valid_until, 'created_at', o.created_at) order by o.created_at desc)
       from (select * from offers where shop_id = p_shop and (valid_until is null or valid_until >= current_date)
             order by created_at desc limit 10) o), '[]'::jsonb));
end $$;

create or replace function public.app_offers()
returns table (offer_id bigint, shop_id uuid, shop_name text, title text, body text, valid_until date, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  return query
  select o.id, s.id, s.name, o.title, o.body, o.valid_until, o.created_at
  from offers o join shops s on s.id = o.shop_id
  join shop_follows f on f.shop_id = o.shop_id and f.user_id = auth.uid() and f.following
  where (o.valid_until is null or o.valid_until >= current_date) and o.created_at > now() - interval '60 days'
  order by o.created_at desc limit 50;
end $$;

create or replace function public.app_follow(p_shop uuid, p_follow boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  if not exists (select 1 from shops where id = p_shop) then raise exception 'NO_SHOP'; end if;
  insert into shop_follows (user_id, shop_id, following) values (auth.uid(), p_shop, p_follow)
  on conflict (user_id, shop_id) do update set following = excluded.following;
end $$;

create or replace function public.app_pending()
returns table (request_id uuid, shop_id uuid, shop_name text, points int, discount numeric, bill_amount numeric, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  update redeem_requests rr set status = 'expired' where rr.user_id = auth.uid() and rr.status = 'pending' and rr.expires_at <= now();
  return query
  select r.id, s.id, s.name, r.points, r.points * s.point_value, r.bill_amount, r.expires_at
  from redeem_requests r join shops s on s.id = r.shop_id
  where r.user_id = auth.uid() and r.status = 'pending' order by r.created_at desc;
end $$;

-- The customer approves or declines a redemption the cashier started.
create or replace function public.app_decide(p_request uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r redeem_requests; res jsonb;
begin
  perform _me_app();
  select * into r from redeem_requests where id = p_request and user_id = auth.uid() for update;
  if not found then raise exception 'NO_REQUEST'; end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'REQUEST_' || upper(r.status)); end if;
  if r.expires_at <= now() then
    update redeem_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'REQUEST_EXPIRED');
  end if;
  if not p_approve then
    update redeem_requests set status = 'declined', decided_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;
  begin
    res := _do_redeem(r.shop_id, r.customer_id, r.bill_amount, r.points, 'app', r.created_by);
  exception when others then
    update redeem_requests set status = 'failed', error = sqlerrm, decided_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'error', (regexp_match(sqlerrm, '[A-Z][A-Z_]{3,}'))[1]);
  end;
  update redeem_requests set status = 'done', decided_at = now(), txn_id = (res->>'txn_id')::bigint where id = r.id;
  return res || jsonb_build_object('status', 'done');
end $$;

create or replace function public.app_register_push(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  insert into push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

-- Used by the server function after the customer proves the phone with a code.
create or replace function public.app_attach_phone(p_user uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m text := _clean_mobile(p_phone); other uuid;
begin
  select user_id into other from app_users where phone = m and user_id <> p_user;
  if found then raise exception 'PHONE_IN_USE'; end if;
  insert into app_users (user_id, member_code, phone)
  values (p_user, 'K' || _random_code(7, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'), m)
  on conflict (user_id) do update set phone = excluded.phone;
  return jsonb_build_object('linked_shops', _link_phone(p_user, m));
end $$;

-- Push tokens of the people a server function needs to notify.
create or replace function public.push_targets_for_offer(p_offer bigint)
returns table (token text, shop_name text, title text, body text)
language sql stable security definer set search_path = public as $$
  select t.token, s.name, o.title, o.body
  from offers o join shops s on s.id = o.shop_id
  join shop_follows f on f.shop_id = o.shop_id and f.following
  join push_tokens t on t.user_id = f.user_id
  where o.id = p_offer;
$$;

create or replace function public.push_targets_for_request(p_request uuid)
returns table (token text, shop_name text, points int, discount numeric)
language sql stable security definer set search_path = public as $$
  select t.token, s.name, r.points, r.points * s.point_value
  from redeem_requests r join shops s on s.id = r.shop_id join push_tokens t on t.user_id = r.user_id
  where r.id = p_request and r.status = 'pending';
$$;

-- ---------------------------------------------------------------- access

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.add_bill(uuid, text, text, numeric, text, boolean, text, text),
  public.customer_balance(uuid, text, text),
  public.start_redemption(uuid, text, text, numeric, int),
  public.redemption_status(uuid, uuid), public.cancel_redemption(uuid, uuid),
  public.send_offer(uuid, text, text, date), public.shop_offers(uuid),
  public.app_me(), public.app_set_name(text), public.app_wallet(), public.app_shop(uuid), public.app_offers(),
  public.app_follow(uuid, boolean), public.app_pending(), public.app_decide(uuid, boolean),
  public.app_register_push(text, text)
to authenticated;
revoke execute on function
  public._me_app(), public._link_phone(uuid, text),
  public._customer_for(uuid, text, text, text, boolean, boolean),
  public.app_attach_phone(uuid, text), public.push_targets_for_offer(bigint), public.push_targets_for_request(uuid)
from authenticated;
grant execute on function public.app_attach_phone(uuid, text), public.push_targets_for_offer(bigint),
  public.push_targets_for_request(uuid), public.is_member(uuid, boolean) to service_role;
-- the public QR page and shop lookup stay open
grant execute on function public.public_balance(text, text), public.public_shop(text) to anon, authenticated;
