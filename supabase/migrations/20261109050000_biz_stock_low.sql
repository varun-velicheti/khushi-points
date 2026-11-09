-- Khushi Biz: owners set when each counted item counts as "low" (default 5).
create or replace function public.biz_stock_low(p_shop uuid, p_item uuid, p_low numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  if p_low is null or p_low < 0 or p_low > 100000 then raise exception 'BAD_QTY'; end if;
  update menu_items set low_stock = p_low where id = p_item and shop_id = p_shop and archived_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke execute on function public.biz_stock_low(uuid, uuid, numeric) from public, anon;
grant execute on function public.biz_stock_low(uuid, uuid, numeric) to authenticated;
