-- Visits and "Regular" status.
-- A visit is a day (in the shop's time zone) on which the customer earned points there.
-- A customer is a Regular at a shop after <regular_visits> visits in the last 90 days.
-- It is rolling: keep visiting to keep the badge.

alter table public.shops
  add column regular_visits int not null default 5 check (regular_visits between 2 and 30);

-- Visits by one customer, all time (p_days null) or in the last p_days days.
create or replace function public._visits(p_customer uuid, p_days int default null)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct (t.created_at at time zone s.timezone)::date)::int
  from transactions t join shops s on s.id = t.shop_id
  where t.customer_id = p_customer and t.kind = 'earn' and t.reversed_at is null
    and (p_days is null or t.created_at > now() - make_interval(days => p_days));
$$;
revoke execute on function public._visits(uuid, int) from public, anon, authenticated;

-- Owner settings: add regular_visits.
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
    regular_visits   = coalesce((p->>'regular_visits')::int, regular_visits),
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

-- Owner dashboard: how many Regulars.
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
    'regulars',       (select count(*) from (select customer_id from transactions where shop_id = p_shop and kind='earn' and reversed_at is null
                         and created_at > now() - interval '90 days' group by customer_id
                         having count(distinct (created_at at time zone s.timezone)::date) >= s.regular_visits) x),
    'regular_visits', s.regular_visits,
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

-- Customers list: visits are days now, plus visits in 90 days and the Regular flag.
drop function if exists public.list_customers(uuid, text);
create function public.list_customers(p_shop uuid, p_search text default null)
returns table (mobile text, name text, balance int, visits int, has_app boolean, last_visit timestamptz,
               visits_90d int, is_regular boolean)
language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  return query
    select c.mobile, c.name, _balance(c.id), _visits(c.id), c.app_user_id is not null,
           (select max(created_at) from transactions t where t.customer_id = c.id and t.reversed_at is null),
           _visits(c.id, 90), _visits(c.id, 90) >= s.regular_visits
    from customers c
    where c.shop_id = p_shop
      and (p_search is null or p_search = '' or c.name ilike '%' || p_search || '%'
           or c.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    order by 6 desc nulls last
    limit 200;
end $$;
revoke execute on function public.list_customers(uuid, text) from public, anon;
grant execute on function public.list_customers(uuid, text) to authenticated;

-- Customer app wallet: visits in 90 days and the shop's Regular target.
drop function if exists public.app_wallet();
create function public.app_wallet()
returns table (shop_id uuid, name text, category text, area text, city text, points int, value numeric,
               expiring_30d int, last_visit timestamptz, following boolean, latest_offer text, latest_offer_at timestamptz,
               logo_path text, visits_90d int, regular_visits int)
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
    (select o.title from offers o where o.shop_id = s.id and o.removed_at is null and (o.valid_until is null or o.valid_until >= current_date)
       order by o.created_at desc limit 1),
    (select o.created_at from offers o where o.shop_id = s.id and o.removed_at is null and (o.valid_until is null or o.valid_until >= current_date)
       order by o.created_at desc limit 1),
    s.logo_path, _visits(c.id, 90), s.regular_visits
  from customers c join shops s on s.id = c.shop_id
  where c.app_user_id = u.user_id
  order by 9 desc nulls last;
end $$;
revoke execute on function public.app_wallet() from public, anon;
grant execute on function public.app_wallet() to authenticated;

-- Customer app shop page: visit counts and Regular status.
create or replace function public.app_shop(p_shop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; s shops; c customers; v90 int;
begin
  u := _me_app();
  select * into s from shops where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
  select * into c from customers where shop_id = p_shop and app_user_id = u.user_id;
  v90 := case when c.id is null then 0 else _visits(c.id, 90) end;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'about', s.about, 'address', s.address,
      'area', s.area, 'city', s.city, 'contact_phone', s.contact_phone, 'hours', s.hours, 'lat', s.lat, 'lng', s.lng,
      'earn_pct', s.earn_pct, 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct,
      'expiry_days', s.expiry_days, 'logo_path', s.logo_path, 'regular_visits', s.regular_visits),
    'following', coalesce((select following from shop_follows where user_id = u.user_id and shop_id = p_shop), false),
    'points', case when c.id is null then 0 else _balance(c.id) end,
    'value', case when c.id is null then 0 else _balance(c.id) * s.point_value end,
    'visits', case when c.id is null then 0 else _visits(c.id) end,
    'visits_90d', v90,
    'is_regular', v90 >= s.regular_visits,
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
        'valid_until', o.valid_until, 'created_at', o.created_at, 'edited_at', o.edited_at) order by o.created_at desc)
       from (select * from offers where shop_id = p_shop and removed_at is null and (valid_until is null or valid_until >= current_date)
             order by created_at desc limit 10) o), '[]'::jsonb));
end $$;

-- "You earned N points" notification: also say when this visit made them a Regular,
-- or when one more visit will.
drop function if exists public.push_targets_for_earn(bigint);
create function public.push_targets_for_earn(p_txn bigint)
returns table (token text, shop_id uuid, shop_name text, points int, balance int,
               visits_90d int, regular_visits int, new_visit boolean)
language sql stable security definer set search_path = public as $$
  select t.token, s.id, s.name, x.points, _balance(c.id), _visits(c.id, 90), s.regular_visits,
    -- first counted bill of the day (a later bill the same day is not a new visit)
    not exists (select 1 from transactions y where y.customer_id = c.id and y.kind = 'earn' and y.reversed_at is null
                and y.id < x.id and (y.created_at at time zone s.timezone)::date = (x.created_at at time zone s.timezone)::date)
  from transactions x join customers c on c.id = x.customer_id join shops s on s.id = x.shop_id
  join push_tokens t on t.user_id = c.app_user_id
  where x.id = p_txn and x.kind = 'earn' and x.reversed_at is null;
$$;
revoke execute on function public.push_targets_for_earn(bigint) from public, anon, authenticated;
grant execute on function public.push_targets_for_earn(bigint) to service_role;
