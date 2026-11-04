-- Shop logo (shown to customers in the app) and owner-deletes-shop.
-- Logos live in the public "shop-logos" storage bucket under <shop id>/<file>.
-- Only that shop's owner can upload or remove them; anyone can view them.

alter table public.shops
  add column logo_path text check (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');

-- True when the storage path starts with a shop id the signed-in user owns.
create or replace function public._owns_logo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare part text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if part !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return is_member(part::uuid, true);
end $$;
revoke execute on function public._owns_logo_path(text) from public, anon;
grant execute on function public._owns_logo_path(text) to authenticated;

-- Storage bucket and rules (skipped on a plain local Postgres used for tests).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('shop-logos', 'shop-logos', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
    execute 'drop policy if exists "shop logos: owners read" on storage.objects';
    execute 'drop policy if exists "shop logos: owners upload" on storage.objects';
    execute 'drop policy if exists "shop logos: owners update" on storage.objects';
    execute 'drop policy if exists "shop logos: owners delete" on storage.objects';
    execute $p$create policy "shop logos: owners read" on storage.objects for select to authenticated
      using (bucket_id = 'shop-logos' and public._owns_logo_path(name))$p$;
    execute $p$create policy "shop logos: owners upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'shop-logos' and public._owns_logo_path(name))$p$;
    execute $p$create policy "shop logos: owners update" on storage.objects for update to authenticated
      using (bucket_id = 'shop-logos' and public._owns_logo_path(name))
      with check (bucket_id = 'shop-logos' and public._owns_logo_path(name))$p$;
    execute $p$create policy "shop logos: owners delete" on storage.objects for delete to authenticated
      using (bucket_id = 'shop-logos' and public._owns_logo_path(name))$p$;
  end if;
end $$;

-- Owner sets (or clears, with null) the shop's logo after uploading it.
create or replace function public.set_shop_logo(p_shop uuid, p_path text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  if p_path is not null and (split_part(p_path, '/', 1) <> p_shop::text or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'BAD_LOGO';
  end if;
  update shops set logo_path = p_path where id = p_shop returning * into s;
  return s;
end $$;

-- Owner deletes the shop for good: customers, points, history, offers, staff and POS key go with it.
-- The owner must type the shop name to confirm. A short record is kept for the platform admin.
create table public.deleted_shops (
  shop_id    uuid primary key,
  name       text not null,
  customers  int not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);
alter table public.deleted_shops enable row level security;

create or replace function public.delete_shop(p_shop uuid, p_confirm text)
returns void language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  select * into s from shops where id = p_shop;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(trim(s.name)) then raise exception 'CONFIRM_NAME'; end if;
  insert into deleted_shops (shop_id, name, customers, deleted_by)
  values (s.id, s.name, (select count(*) from customers where shop_id = s.id), auth.uid());
  delete from shops where id = p_shop;
end $$;

revoke execute on function public.set_shop_logo(uuid, text), public.delete_shop(uuid, text) from public, anon;
grant execute on function public.set_shop_logo(uuid, text), public.delete_shop(uuid, text) to authenticated;

-- Customer app: every place that shows a shop now also returns its logo.
drop function if exists public.app_wallet();
create function public.app_wallet()
returns table (shop_id uuid, name text, category text, area text, city text, points int, value numeric,
               expiring_30d int, last_visit timestamptz, following boolean, latest_offer text, latest_offer_at timestamptz,
               logo_path text)
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
    s.logo_path
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
      'expiry_days', s.expiry_days, 'logo_path', s.logo_path),
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

drop function if exists public.app_offers();
create function public.app_offers()
returns table (offer_id bigint, shop_id uuid, shop_name text, title text, body text, valid_until date, created_at timestamptz,
               logo_path text)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  return query
  select o.id, s.id, s.name, o.title, o.body, o.valid_until, o.created_at, s.logo_path
  from offers o join shops s on s.id = o.shop_id
  join shop_follows f on f.shop_id = o.shop_id and f.user_id = auth.uid() and f.following
  where o.removed_at is null and (o.valid_until is null or o.valid_until >= current_date) and o.created_at > now() - interval '60 days'
  order by o.created_at desc limit 50;
end $$;

drop function if exists public.app_pending();
create function public.app_pending()
returns table (request_id uuid, shop_id uuid, shop_name text, points int, discount numeric, bill_amount numeric, expires_at timestamptz,
               logo_path text)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  update redeem_requests rr set status = 'expired' where rr.user_id = auth.uid() and rr.status = 'pending' and rr.expires_at <= now();
  return query
  select r.id, s.id, s.name, r.points, r.points * s.point_value, r.bill_amount, r.expires_at, s.logo_path
  from redeem_requests r join shops s on s.id = r.shop_id
  where r.user_id = auth.uid() and r.status = 'pending' order by r.created_at desc;
end $$;

drop function if exists public.app_activity(int);
create function public.app_activity(p_limit int default 10)
returns table (shop_id uuid, shop_name text, kind text, points int, amount numeric, at timestamptz, logo_path text)
language plpgsql security definer set search_path = public as $$
begin
  perform _me_app();
  return query
  select s.id, s.name, t.kind, t.points, t.amount, t.created_at, s.logo_path
  from transactions t join customers c on c.id = t.customer_id join shops s on s.id = t.shop_id
  where c.app_user_id = auth.uid() and t.reversed_at is null
  order by t.created_at desc limit least(p_limit, 50);
end $$;

revoke execute on function public.app_wallet(), public.app_offers(), public.app_pending(), public.app_activity(int) from public, anon;
grant execute on function public.app_wallet(), public.app_offers(), public.app_pending(), public.app_activity(int) to authenticated;
