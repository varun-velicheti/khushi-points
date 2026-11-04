-- The platform admin (app creator) can delete any shop and everything that belongs to it,
-- the same way an owner deletes their own shop: type the shop name to confirm.

-- Admins may also list and remove any shop's logo files.
create or replace function public._owns_logo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare part text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if part !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return is_member(part::uuid, true) or is_platform_admin();
end $$;

create or replace function public.admin_delete_shop(p_shop uuid, p_confirm text)
returns void language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform _require_admin();
  select * into s from shops where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(trim(s.name)) then raise exception 'CONFIRM_NAME'; end if;
  insert into deleted_shops (shop_id, name, customers, deleted_by)
  values (s.id, s.name, (select count(*) from customers where shop_id = s.id), auth.uid());
  delete from shops where id = p_shop;
end $$;

revoke execute on function public.admin_delete_shop(uuid, text) from public, anon;
grant execute on function public.admin_delete_shop(uuid, text) to authenticated;
