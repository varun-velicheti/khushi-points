-- Platform admin view: activity across all shops, for the Khushi Points team.
-- Shows totals only. No customer numbers or names are exposed.

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: read only through functions

-- First admin: the founder's login email (no-op if that account does not exist yet).
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'varunkumarvelicheti@gmail.com'
on conflict do nothing;

-- Accounts created later with that email become admin automatically.
create or replace function public._auto_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'varunkumarvelicheti@gmail.com' then
    insert into platform_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger auto_admin after insert on auth.users for each row execute function public._auto_admin();

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_platform_admin() then raise exception 'ADMIN_ONLY'; end if;
end $$;

-- Whole-platform totals.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_admin();
  return jsonb_build_object(
    'shops',            (select count(*) from shops),
    'shops_active_7d',  (select count(distinct shop_id) from transactions where reversed_at is null and created_at > now() - interval '7 days'),
    'staff',            (select count(*) from shop_members),
    'customers',        (select count(*) from customers),
    'customers_pin',    (select count(*) from customers where pin_hash is not null),
    'bills_today',      (select count(*) from transactions where kind = 'earn' and reversed_at is null
                           and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date),
    'bills_30d',        (select count(*) from transactions where kind = 'earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'sales_30d',        (select coalesce(sum(amount), 0) from transactions where kind = 'earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'redeems_30d',      (select count(*) from transactions where kind = 'redeem' and reversed_at is null and created_at > now() - interval '30 days'),
    'redeems_pin_30d',  (select count(*) from transactions where kind = 'redeem' and method = 'pin' and reversed_at is null and created_at > now() - interval '30 days'),
    'undone_30d',       (select count(*) from transactions where reversed_at is not null and created_at > now() - interval '30 days'),
    'sms_30d',          (select count(*) from sms_log where status in ('sent', 'demo') and created_at > now() - interval '30 days'),
    'sms_real_30d',     (select count(*) from sms_log where status = 'sent' and created_at > now() - interval '30 days'),
    'sms_failed_7d',    (select count(*) from sms_log where status = 'failed' and created_at > now() - interval '7 days'),
    'sms_last_error',   (select provider_ref from sms_log where status = 'failed' order by created_at desc limit 1),
    'points_owed_value',(select coalesce(sum(l.points_left * s.point_value), 0) from point_lots l join shops s on s.id = l.shop_id
                           where l.points_left > 0 and l.expires_at > now()),
    'bills_by_day',     (select jsonb_agg(q.n order by q.d) from (
                           select g.d::date as d,
                                  (select count(*) from transactions t where t.kind = 'earn' and t.reversed_at is null
                                     and (t.created_at at time zone 'Asia/Kolkata')::date = g.d::date) as n
                           from generate_series((now() at time zone 'Asia/Kolkata')::date - 13,
                                                (now() at time zone 'Asia/Kolkata')::date, interval '1 day') as g(d)) q));
end $$;

-- One row per shop, most recently active first.
create or replace function public.admin_shops()
returns table (
  shop_id uuid, name text, plan text, created_at timestamptz, owner_email text, staff int,
  customers int, customers_pin int, bills_7d int, bills_30d int, sales_30d numeric,
  redeems_30d int, redeems_pin_30d int, sms_30d int, sms_failed_7d int,
  last_activity timestamptz, bills_by_day int[])
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_admin();
  return query
  select s.id, s.name, s.plan, s.created_at,
    (select u.email::text from shop_members m join auth.users u on u.id = m.user_id
      where m.shop_id = s.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*)::int from shop_members m where m.shop_id = s.id),
    (select count(*)::int from customers c where c.shop_id = s.id),
    (select count(*)::int from customers c where c.shop_id = s.id and c.pin_hash is not null),
    (select count(*)::int from transactions t where t.shop_id = s.id and t.kind = 'earn' and t.reversed_at is null and t.created_at > now() - interval '7 days'),
    (select count(*)::int from transactions t where t.shop_id = s.id and t.kind = 'earn' and t.reversed_at is null and t.created_at > now() - interval '30 days'),
    (select coalesce(sum(t.amount), 0) from transactions t where t.shop_id = s.id and t.kind = 'earn' and t.reversed_at is null and t.created_at > now() - interval '30 days'),
    (select count(*)::int from transactions t where t.shop_id = s.id and t.kind = 'redeem' and t.reversed_at is null and t.created_at > now() - interval '30 days'),
    (select count(*)::int from transactions t where t.shop_id = s.id and t.kind = 'redeem' and t.method = 'pin' and t.reversed_at is null and t.created_at > now() - interval '30 days'),
    (select count(*)::int from sms_log l where l.shop_id = s.id and l.status in ('sent', 'demo') and l.created_at > now() - interval '30 days'),
    (select count(*)::int from sms_log l where l.shop_id = s.id and l.status = 'failed' and l.created_at > now() - interval '7 days'),
    (select max(t.created_at) from transactions t where t.shop_id = s.id),
    (select array_agg((select count(*)::int from transactions t where t.shop_id = s.id and t.kind = 'earn' and t.reversed_at is null
                        and (t.created_at at time zone 'Asia/Kolkata')::date = g.d::date) order by g.d)
       from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') g(d))
  from shops s
  order by 16 desc nulls last, s.created_at desc;
end $$;

revoke execute on function public.is_platform_admin(), public._require_admin(), public.admin_overview(), public.admin_shops(), public._auto_admin()
  from public, anon;
grant execute on function public.is_platform_admin(), public.admin_overview(), public.admin_shops() to authenticated;
