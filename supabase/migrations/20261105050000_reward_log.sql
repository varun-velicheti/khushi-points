-- Owner: the last rewards handed over at the counter, with who gave them.
create or replace function public.shop_reward_log(p_shop uuid, p_limit int default 50)
returns table (given_at timestamptz, title text, customer_name text, mobile text, given_by text, earned_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  return query
  select g.used_at, g.title, c.name, c.mobile, coalesce(u.email::text, 'Former staff'), g.earned_at
  from reward_grants g
  join customers c on c.id = g.customer_id
  left join auth.users u on u.id = g.used_by
  where g.shop_id = p_shop and g.used_at is not null
  order by g.used_at desc limit least(coalesce(p_limit, 50), 200);
end $$;
revoke execute on function public.shop_reward_log(uuid, int) from public, anon;
grant execute on function public.shop_reward_log(uuid, int) to authenticated;
