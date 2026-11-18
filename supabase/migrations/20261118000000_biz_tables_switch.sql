-- POS: tables can be switched off (like the kitchen screen). Off: no floor of tables and takeaways;
-- the POS opens straight on the menu with the current counter order. On for every shop until changed.

alter table public.shops add column biz_tables boolean not null default true;

create or replace function public.biz_save_settings(p_shop uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update shops set
    gstin         = case when p ? 'gstin' then nullif(upper(trim(p->>'gstin')), '') else gstin end,
    legal_name    = case when p ? 'legal_name' then nullif(trim(p->>'legal_name'), '') else legal_name end,
    gst_inclusive = coalesce((p->>'gst_inclusive')::boolean, gst_inclusive),
    upi_id        = case when p ? 'upi_id' then nullif(trim(p->>'upi_id'), '') else upi_id end,
    biz_kitchen   = coalesce((p->>'kitchen')::boolean, biz_kitchen),
    biz_tables    = coalesce((p->>'use_tables')::boolean, biz_tables)
  where id = p_shop;
end $$;

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
      'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct, 'logo_path', s.logo_path, 'kitchen', s.biz_kitchen, 'use_tables', s.biz_tables, 'timezone', s.timezone),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from menu_categories where shop_id = p_shop), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'price', price,
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort,
        'track_stock', track_stock, 'stock', stock, 'low_stock', low_stock, 'options', options) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by name)
      from biz_staff where shop_id = p_shop and active), '[]'));
end $$;
