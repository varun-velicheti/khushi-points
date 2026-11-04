-- Owners can edit or remove an offer they sent.
-- Editing does not notify again. A removed offer disappears from customers' apps
-- but still counts toward the 2-offers-per-week limit (so send/remove/resend cannot spam).

alter table public.offers add column edited_at timestamptz, add column removed_at timestamptz;

create or replace function public.update_offer(p_shop uuid, p_offer bigint, p_title text, p_body text default '', p_valid_until date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  if p_valid_until is not null and p_valid_until < current_date then raise exception 'BAD_DATE'; end if;
  update offers set title = trim(p_title), body = trim(coalesce(p_body, '')), valid_until = p_valid_until, edited_at = now()
  where id = p_offer and shop_id = p_shop and removed_at is null;
  if not found then raise exception 'NO_OFFER'; end if;
end $$;

create or replace function public.remove_offer(p_shop uuid, p_offer bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update offers set removed_at = now() where id = p_offer and shop_id = p_shop and removed_at is null;
  if not found then raise exception 'NO_OFFER'; end if;
end $$;

drop function if exists public.shop_offers(uuid);
create function public.shop_offers(p_shop uuid)
returns table (id bigint, title text, body text, valid_until date, created_at timestamptz, recipients int,
               edited_at timestamptz, removed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query select o.id, o.title, o.body, o.valid_until, o.created_at, o.recipients, o.edited_at, o.removed_at
  from offers o where o.shop_id = p_shop order by o.created_at desc limit 20;
end $$;

-- Customer app and notifications skip removed offers.
create or replace function public.app_wallet()
returns table (shop_id uuid, name text, category text, area text, city text, points int, value numeric,
               expiring_30d int, last_visit timestamptz, following boolean, latest_offer text, latest_offer_at timestamptz)
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
       order by o.created_at desc limit 1)
  from customers c join shops s on s.id = c.shop_id
  where c.app_user_id = u.user_id
  order by 9 desc nulls last;
end $$;

create or replace function public.app_shop(p_shop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; s shops; c customers;
begin
  u := _me_app();
  select * into s from shops where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
  select * into c from customers where shop_id = p_shop and app_user_id = u.user_id;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'about', s.about, 'address', s.address,
      'area', s.area, 'city', s.city, 'contact_phone', s.contact_phone, 'hours', s.hours, 'lat', s.lat, 'lng', s.lng,
      'earn_pct', s.earn_pct, 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct,
      'expiry_days', s.expiry_days),
    'following', coalesce((select following from shop_follows where user_id = u.user_id and shop_id = p_shop), false),
    'points', case when c.id is null then 0 else _balance(c.id) end,
    'value', case when c.id is null then 0 else _balance(c.id) * s.point_value end,
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

create or replace function public.app_offers()
returns table (offer_id bigint, shop_id uuid, shop_name text, title text, body text, valid_until date, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  return query
  select o.id, s.id, s.name, o.title, o.body, o.valid_until, o.created_at
  from offers o join shops s on s.id = o.shop_id
  join shop_follows f on f.shop_id = o.shop_id and f.user_id = auth.uid() and f.following
  where o.removed_at is null and (o.valid_until is null or o.valid_until >= current_date) and o.created_at > now() - interval '60 days'
  order by o.created_at desc limit 50;
end $$;

create or replace function public.push_targets_for_offer(p_offer bigint)
returns table (token text, shop_name text, title text, body text)
language sql stable security definer set search_path = public as $$
  select t.token, s.name, o.title, o.body
  from offers o join shops s on s.id = o.shop_id
  join shop_follows f on f.shop_id = o.shop_id and f.following
  join push_tokens t on t.user_id = f.user_id
  where o.id = p_offer and o.removed_at is null;
$$;

revoke execute on function public.update_offer(uuid, bigint, text, text, date), public.remove_offer(uuid, bigint),
  public.shop_offers(uuid) from public, anon;
grant execute on function public.update_offer(uuid, bigint, text, text, date), public.remove_offer(uuid, bigint),
  public.shop_offers(uuid) to authenticated;
