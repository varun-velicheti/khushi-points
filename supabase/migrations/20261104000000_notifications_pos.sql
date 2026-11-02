-- Notifications and billing-software (POS) connection:
-- 1. "You earned N points" right after every bill (counter screen or POS)
-- 2. Daily expiry reminders at 10:30 AM IST, N days before (each shop picks the days)
-- 3. Per-shop POS key so Petpooja or any POS can send bills automatically

alter table public.app_users add column reminders boolean not null default true;
alter table public.shops
  add column reminder_days int[] not null default '{7,1}'
    check (cardinality(reminder_days) <= 3 and 1 <= all(reminder_days) and 60 >= all(reminder_days));

-- Only a hash of each shop's POS key is kept, in a table nobody can read directly.
create table public.shop_pos_keys (
  shop_id    uuid primary key references public.shops(id) on delete cascade,
  key_hash   text not null unique,
  hint       text not null,
  created_at timestamptz not null default now()
);
alter table public.shop_pos_keys enable row level security;
alter table public.transactions add column source text not null default 'counter' check (source in ('counter','pos'));

create table public.reminder_log (
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_on  date not null,
  days_before int  not null,
  sent_at     timestamptz not null default now(),
  primary key (customer_id, expires_on, days_before)
);
alter table public.reminder_log enable row level security;

-- ---------------------------------------------------------------- earning, shared by the counter and POS

create or replace function public._add_bill_core(
  p_shop uuid, p_staff uuid, p_source text, p_mobile text, p_bill_no text, p_amount numeric,
  p_name text, p_consent boolean, p_member text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; c customers; pts int; is_new boolean; bill text;
  today_pts int := 0; today_max numeric := 0; award int; v_txn bigint;
begin
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

  insert into transactions (shop_id, customer_id, kind, bill_no, amount, points, staff_id, note, source)
  values (p_shop, c.id, 'earn', bill, p_amount, award, p_staff, nullif(trim(coalesce(p_note, '')), ''), p_source)
  returning id into v_txn;
  insert into point_lots (shop_id, customer_id, points, points_left, expires_at, txn_id)
  values (p_shop, c.id, award, award, now() + make_interval(days => s.expiry_days), v_txn);

  return jsonb_build_object('txn_id', v_txn, 'points', award, 'bill_points', pts,
    'topped_up', today_pts > 0, 'earlier_today', today_pts, 'earlier_bill', today_max,
    'balance', _balance(c.id), 'value', _balance(c.id) * s.point_value,
    'name', c.name, 'is_new', is_new, 'has_app', c.app_user_id is not null);
end $$;

create or replace function public.add_bill(
  p_shop uuid, p_mobile text default null, p_bill_no text default null, p_amount numeric default null,
  p_name text default null, p_consent boolean default false, p_member text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return _add_bill_core(p_shop, auth.uid(), 'counter', p_mobile, p_bill_no, p_amount, p_name, p_consent, p_member, p_note);
end $$;

-- ---------------------------------------------------------------- POS connection

-- Owner makes a new key; the full key is shown once. Making a new one turns the old one off.
create or replace function public.new_pos_key(p_shop uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text := 'kp_live_' || encode(gen_random_bytes(24), 'hex');
begin
  perform _require_member(p_shop, true);
  insert into shop_pos_keys (shop_id, key_hash, hint) values (p_shop, encode(digest(k, 'sha256'), 'hex'), right(k, 4))
  on conflict (shop_id) do update set key_hash = excluded.key_hash, hint = excluded.hint, created_at = now();
  return k;
end $$;

create or replace function public.remove_pos_key(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  delete from shop_pos_keys where shop_id = p_shop;
end $$;

-- Called by the pos-bill server function. The POS has the customer's number on the bill;
-- the shop is responsible for the customer's consent (see Terms).
create or replace function public.pos_add_bill(
  p_key text, p_mobile text, p_amount numeric, p_bill_no text default null, p_note text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s shops;
begin
  select s2.* into s from shops s2 join shop_pos_keys k on k.shop_id = s2.id
  where k.key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if not found then raise exception 'BAD_POS_KEY'; end if;
  return _add_bill_core(s.id, null, 'pos', p_mobile, p_bill_no, p_amount, p_name, true, null, p_note)
         || jsonb_build_object('shop_id', s.id);
end $$;

-- ---------------------------------------------------------------- earned-points notification

create or replace function public.push_targets_for_earn(p_txn bigint)
returns table (token text, shop_id uuid, shop_name text, points int, balance int)
language sql stable security definer set search_path = public as $$
  select t.token, s.id, s.name, x.points, _balance(c.id)
  from transactions x join customers c on c.id = x.customer_id join shops s on s.id = x.shop_id
  join push_tokens t on t.user_id = c.app_user_id
  where x.id = p_txn and x.kind = 'earn' and x.reversed_at is null;
$$;

-- ---------------------------------------------------------------- expiry reminders

-- Reminders due now: one per customer, shop, expiry date and "days before". Marks them as sent.
create or replace function public.expiry_reminders_due()
returns table (token text, shop_id uuid, title text, body text)
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return query
  with due as (
    select c.id as customer_id, c.app_user_id, s.id as shop_id, s.name as shop_name, d as days_before,
           (l.expires_at at time zone 'Asia/Kolkata')::date as expires_on, sum(l.points_left)::int as pts
    from point_lots l
    join customers c on c.id = l.customer_id
    join shops s on s.id = l.shop_id
    join app_users u on u.user_id = c.app_user_id and u.reminders
    cross join lateral unnest(s.reminder_days) d
    where l.points_left > 0 and l.expires_at > now()
      and (l.expires_at at time zone 'Asia/Kolkata')::date = today + d
    group by 1, 2, 3, 4, 5, 6
  ), fresh as (
    insert into reminder_log (customer_id, expires_on, days_before)
    select customer_id, expires_on, days_before from due
    on conflict do nothing
    returning customer_id, expires_on, days_before
  )
  select t.token, due.shop_id,
    due.pts || ' points at ' || due.shop_name || ' expire ' ||
      case when due.days_before = 1 then 'tomorrow' else 'in ' || due.days_before || ' days' end,
    'Use them at ' || due.shop_name || ' before ' || to_char(due.expires_on, 'FMDD Mon') || '.'
  from due
  join fresh f on f.customer_id = due.customer_id and f.expires_on = due.expires_on and f.days_before = due.days_before
  join push_tokens t on t.user_id = due.app_user_id;
end $$;

-- Sends the due reminders straight to Expo's push service (runs daily from the scheduler).
create or replace function public.send_expiry_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare msgs jsonb; n int := 0;
begin
  for msgs in
    select jsonb_agg(jsonb_build_object('to', r.token, 'title', r.title, 'body', r.body, 'channelId', 'offers',
             'data', jsonb_build_object('type', 'expiry', 'shop_id', r.shop_id)))
    from (select *, (row_number() over () - 1) / 100 as chunk from expiry_reminders_due()) r
    group by r.chunk
  loop
    perform net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := msgs,
      headers := '{"Content-Type": "application/json"}'::jsonb);
    n := n + jsonb_array_length(msgs);
  end loop;
  return n;
end $$;

-- Daily at 05:00 UTC = 10:30 AM IST. Only where the scheduler is available (Supabase has it).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('khushi-expiry-reminders', '0 5 * * *', 'select public.send_expiry_reminders()');
  end if;
end $$;

-- ---------------------------------------------------------------- customer app

create or replace function public.app_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _me_app();
  perform _link_phone(u.user_id, u.phone);
  return jsonb_build_object('name', u.name, 'phone', u.phone, 'member_code', u.member_code, 'reminders', u.reminders,
    'email', (select email from auth.users where id = u.user_id));
end $$;

create or replace function public.app_set_reminders(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  update app_users set reminders = p_on where user_id = auth.uid();
end $$;

-- Latest points earned or used, across all my shops.
create or replace function public.app_activity(p_limit int default 10)
returns table (shop_id uuid, shop_name text, kind text, points int, amount numeric, at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  return query
  select s.id, s.name, t.kind, t.points, t.amount, t.created_at
  from transactions t join customers c on c.id = t.customer_id join shops s on s.id = t.shop_id
  where c.app_user_id = auth.uid() and t.reversed_at is null
  order by t.created_at desc limit least(p_limit, 50);
end $$;

-- Owner settings now include reminder days.
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
    reminder_days    = case when p ? 'reminder_days'
                         then coalesce((select array_agg(distinct x::int order by x::int desc) from jsonb_array_elements_text(p->'reminder_days') x), '{}')
                         else reminder_days end,
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

-- Owner sees whether a key exists (last 4 characters only).
create or replace function public.pos_key_status(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  return (select jsonb_build_object('hint', hint, 'created_at', created_at) from shop_pos_keys where shop_id = p_shop);
end $$;
grant execute on function public.pos_key_status(uuid) to authenticated;
revoke execute on function public.pos_key_status(uuid) from public, anon;

revoke execute on function public._add_bill_core(uuid, uuid, text, text, text, numeric, text, boolean, text, text),
  public.pos_add_bill(text, text, numeric, text, text, text), public.push_targets_for_earn(bigint),
  public.expiry_reminders_due(), public.send_expiry_reminders()
from public, anon, authenticated;
grant execute on function public.pos_add_bill(text, text, numeric, text, text, text), public.push_targets_for_earn(bigint),
  public.expiry_reminders_due(), public.send_expiry_reminders() to service_role;
grant execute on function public.new_pos_key(uuid), public.remove_pos_key(uuid), public.app_set_reminders(boolean),
  public.app_activity(int) to authenticated;
revoke execute on function public.new_pos_key(uuid), public.remove_pos_key(uuid), public.app_set_reminders(boolean),
  public.app_activity(int) from public, anon;
