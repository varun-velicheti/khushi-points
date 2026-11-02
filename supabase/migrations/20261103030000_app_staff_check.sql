-- Shop owners and cashiers delete their accounts by contacting support, not from the customer app.
create or replace function public.app_is_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_members where user_id = p_user);
$$;
revoke execute on function public.app_is_staff(uuid) from public, anon, authenticated;
grant execute on function public.app_is_staff(uuid) to service_role;
