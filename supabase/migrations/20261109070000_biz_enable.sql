-- Khushi Biz is switched on per shop by the platform admin (off for new shops).
-- Shops that already set up a Khushi Biz menu stay on.
alter table public.shops add column biz_enabled boolean not null default false;
update public.shops s set biz_enabled = true where exists (select 1 from public.menu_items i where i.shop_id = s.id);

create or replace function public.admin_set_biz(p_shop uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  update shops set biz_enabled = p_on where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
end $$;

-- Admin shop list also shows the switch.
drop function if exists public.admin_shops();
create function public.admin_shops()
returns table (
  shop_id uuid, name text, plan text, created_at timestamptz, owner_email text, staff int,
  customers int, customers_pin int, bills_7d int, bills_30d int, sales_30d numeric,
  redeems_30d int, redeems_pin_30d int, sms_30d int, sms_failed_7d int,
  last_activity timestamptz, bills_by_day int[], biz_enabled boolean)
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
       from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') g(d)),
    s.biz_enabled
  from shops s
  order by 16 desc nulls last, s.created_at desc;
end $$;

-- Khushi Biz only opens for shops it is switched on for.
create or replace function public.biz_menu(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  if not s.biz_enabled then raise exception 'BIZ_NOT_ENABLED'; end if;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'legal_name', s.legal_name, 'gstin', s.gstin, 'address', s.address,
      'contact_phone', s.contact_phone, 'gst_inclusive', s.gst_inclusive, 'upi_id', s.upi_id,
      'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct, 'logo_path', s.logo_path, 'kitchen', s.biz_kitchen, 'timezone', s.timezone),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from menu_categories where shop_id = p_shop), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'price', price,
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort,
        'track_stock', track_stock, 'stock', stock, 'low_stock', low_stock) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'));
end $$;

revoke execute on function public.admin_set_biz(uuid, boolean), public.admin_shops() from public, anon;
grant execute on function public.admin_set_biz(uuid, boolean), public.admin_shops() to authenticated;
