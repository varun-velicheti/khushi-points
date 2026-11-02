-- Customers list shows who uses the app (replaces the old PIN/OTP column).
drop function if exists public.list_customers(uuid, text);
create function public.list_customers(p_shop uuid, p_search text default null)
returns table (mobile text, name text, balance int, visits bigint, has_app boolean, last_visit timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
    select c.mobile, c.name, _balance(c.id),
           (select count(*) from transactions t where t.customer_id = c.id and t.kind = 'earn' and t.reversed_at is null),
           c.app_user_id is not null,
           (select max(created_at) from transactions t where t.customer_id = c.id and t.reversed_at is null)
    from customers c
    where c.shop_id = p_shop
      and (p_search is null or p_search = '' or c.name ilike '%' || p_search || '%'
           or c.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    order by 6 desc nulls last
    limit 200;
end $$;
revoke execute on function public.list_customers(uuid, text) from public, anon;
grant execute on function public.list_customers(uuid, text) to authenticated;
