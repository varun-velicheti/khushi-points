-- Rewards that are not discounts: "free chai every 5th visit", "a gift for our Regulars".
-- A bill that counts as a new visit can unlock rewards; the cashier hands them over at the counter.
-- Unlocked rewards last 60 days. Undoing the bill takes back rewards it unlocked (if not yet given).

create table public.rewards (
  id           bigint generated always as identity primary key,
  shop_id      uuid not null references public.shops(id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 2 and 60),
  details      text not null default '' check (char_length(details) <= 200),
  trigger      text not null check (trigger in ('visits', 'regular')),
  every_visits int check (every_visits between 2 and 50),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  removed_at   timestamptz,
  check ((trigger = 'visits') = (every_visits is not null))
);
create index on public.rewards (shop_id) where removed_at is null;

create table public.reward_grants (
  id          bigint generated always as identity primary key,
  reward_id   bigint not null references public.rewards(id) on delete cascade,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  txn_id      bigint references public.transactions(id) on delete set null,
  title       text not null,
  earned_at   timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 days',
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);
create index on public.reward_grants (customer_id) where used_at is null;
create index on public.reward_grants (shop_id, earned_at desc);

alter table public.rewards enable row level security;
alter table public.reward_grants enable row level security;

-- ---------------------------------------------------------------- unlocking

create or replace function public._grant_rewards()
returns trigger language plpgsql security definer set search_path = public as $$
declare s shops; r rewards; v_total int; v90 int;
begin
  if new.kind <> 'earn' or new.reversed_at is not null then return new; end if;
  select * into s from shops where id = new.shop_id;
  -- only the first counted bill of the day is a new visit
  if exists (select 1 from transactions y where y.customer_id = new.customer_id and y.kind = 'earn' and y.reversed_at is null
             and y.id < new.id and (y.created_at at time zone s.timezone)::date = (new.created_at at time zone s.timezone)::date) then
    return new;
  end if;
  v_total := _visits(new.customer_id);
  v90 := _visits(new.customer_id, 90);
  for r in select * from rewards where shop_id = new.shop_id and active and removed_at is null loop
    if r.trigger = 'visits' and v_total % r.every_visits = 0
       or r.trigger = 'regular' and v90 = s.regular_visits
          and not exists (select 1 from reward_grants g where g.reward_id = r.id and g.customer_id = new.customer_id
                          and g.earned_at > now() - interval '90 days') then
      insert into reward_grants (reward_id, shop_id, customer_id, txn_id, title)
      values (r.id, new.shop_id, new.customer_id, new.id, r.title);
    end if;
  end loop;
  return new;
end $$;
create trigger grant_rewards after insert on public.transactions for each row execute function public._grant_rewards();

create or replace function public._take_back_rewards()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reversed_at is not null and old.reversed_at is null then
    delete from reward_grants where txn_id = new.id and used_at is null;
  end if;
  return new;
end $$;
create trigger take_back_rewards after update of reversed_at on public.transactions
  for each row execute function public._take_back_rewards();

-- ---------------------------------------------------------------- owner: manage rewards

create or replace function public.add_reward(p_shop uuid, p_title text, p_details text, p_trigger text, p_every int default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  perform _require_member(p_shop, true);
  if (select count(*) from rewards where shop_id = p_shop and removed_at is null) >= 5 then raise exception 'REWARD_LIMIT'; end if;
  insert into rewards (shop_id, title, details, trigger, every_visits)
  values (p_shop, trim(p_title), trim(coalesce(p_details, '')), p_trigger, case when p_trigger = 'visits' then p_every end)
  returning id into rid;
  return rid;
end $$;

create or replace function public.update_reward(p_shop uuid, p_reward bigint, p_title text, p_details text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update rewards set title = trim(p_title), details = trim(coalesce(p_details, '')), active = p_active
  where id = p_reward and shop_id = p_shop and removed_at is null;
  if not found then raise exception 'NO_REWARD'; end if;
end $$;

-- Removing stops new unlocks; rewards customers already unlocked can still be given.
create or replace function public.remove_reward(p_shop uuid, p_reward bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update rewards set removed_at = now(), active = false where id = p_reward and shop_id = p_shop and removed_at is null;
  if not found then raise exception 'NO_REWARD'; end if;
end $$;

create or replace function public.shop_rewards(p_shop uuid)
returns table (id bigint, title text, details text, trigger text, every_visits int, active boolean,
               unlocked_30d int, given_30d int, waiting int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
  select r.id, r.title, r.details, r.trigger, r.every_visits, r.active,
    (select count(*)::int from reward_grants g where g.reward_id = r.id and g.earned_at > now() - interval '30 days'),
    (select count(*)::int from reward_grants g where g.reward_id = r.id and g.used_at > now() - interval '30 days'),
    (select count(*)::int from reward_grants g where g.reward_id = r.id and g.used_at is null and g.expires_at > now())
  from rewards r where r.shop_id = p_shop and r.removed_at is null order by r.created_at;
end $$;

-- ---------------------------------------------------------------- counter: see and give rewards

create or replace function public._find_customer(p_shop uuid, p_mobile text, p_member text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare u app_users; cid uuid;
begin
  if nullif(trim(coalesce(p_member, '')), '') is not null then
    select * into u from app_users where member_code = upper(regexp_replace(trim(p_member), '^KP:', '', 'i'));
    if not found then return null; end if;
    select id into cid from customers where shop_id = p_shop and (app_user_id = u.user_id or (u.phone is not null and mobile = u.phone))
    order by (app_user_id = u.user_id) desc nulls last limit 1;
  else
    select id into cid from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile);
  end if;
  return cid;
end $$;

create or replace function public.customer_rewards(p_shop uuid, p_mobile text default null, p_member text default null)
returns table (grant_id bigint, title text, details text, earned_at timestamptz, expires_at timestamptz, txn_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  perform _require_member(p_shop);
  cid := _find_customer(p_shop, p_mobile, p_member);
  return query
  select g.id, g.title, coalesce(r.details, ''), g.earned_at, g.expires_at, g.txn_id
  from reward_grants g left join rewards r on r.id = g.reward_id
  where cid is not null and g.customer_id = cid and g.shop_id = p_shop and g.used_at is null and g.expires_at > now()
  order by g.earned_at;
end $$;

create or replace function public.use_reward(p_shop uuid, p_grant bigint)
returns void language plpgsql security definer set search_path = public as $$
declare g reward_grants;
begin
  perform _require_member(p_shop);
  select * into g from reward_grants where id = p_grant and shop_id = p_shop for update;
  if not found then raise exception 'NO_REWARD'; end if;
  if g.used_at is not null then raise exception 'REWARD_USED'; end if;
  if g.expires_at <= now() then raise exception 'REWARD_EXPIRED'; end if;
  update reward_grants set used_at = now(), used_by = auth.uid() where id = p_grant;
end $$;

-- ---------------------------------------------------------------- customer app

drop function if exists public.app_wallet();
create function public.app_wallet()
returns table (shop_id uuid, name text, category text, area text, city text, points int, value numeric,
               expiring_30d int, last_visit timestamptz, following boolean, latest_offer text, latest_offer_at timestamptz,
               logo_path text, visits_90d int, regular_visits int, rewards_ready int)
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
    s.logo_path, _visits(c.id, 90), s.regular_visits,
    (select count(*)::int from reward_grants g where g.customer_id = c.id and g.used_at is null and g.expires_at > now())
  from customers c join shops s on s.id = c.shop_id
  where c.app_user_id = u.user_id
  order by 9 desc nulls last;
end $$;
revoke execute on function public.app_wallet() from public, anon;
grant execute on function public.app_wallet() to authenticated;

create or replace function public.app_shop(p_shop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; s shops; c customers; v90 int; vt int;
begin
  u := _me_app();
  select * into s from shops where id = p_shop;
  if not found then raise exception 'NO_SHOP'; end if;
  select * into c from customers where shop_id = p_shop and app_user_id = u.user_id;
  v90 := case when c.id is null then 0 else _visits(c.id, 90) end;
  vt := case when c.id is null then 0 else _visits(c.id) end;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'about', s.about, 'address', s.address,
      'area', s.area, 'city', s.city, 'contact_phone', s.contact_phone, 'hours', s.hours, 'lat', s.lat, 'lng', s.lng,
      'earn_pct', s.earn_pct, 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct,
      'expiry_days', s.expiry_days, 'logo_path', s.logo_path, 'regular_visits', s.regular_visits),
    'following', coalesce((select following from shop_follows where user_id = u.user_id and shop_id = p_shop), false),
    'points', case when c.id is null then 0 else _balance(c.id) end,
    'value', case when c.id is null then 0 else _balance(c.id) * s.point_value end,
    'visits', vt,
    'visits_90d', v90,
    'is_regular', v90 >= s.regular_visits,
    -- rewards waiting to be collected at the counter
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'details', coalesce(r.details, ''),
        'earned_at', g.earned_at, 'expires_at', g.expires_at) order by g.earned_at)
       from reward_grants g left join rewards r on r.id = g.reward_id
       where c.id is not null and g.customer_id = c.id and g.used_at is null and g.expires_at > now()), '[]'::jsonb),
    -- what the shop offers, with how close I am
    'programs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'details', r.details, 'trigger', r.trigger,
        'every_visits', r.every_visits,
        'visits_left', case when r.trigger = 'visits' then r.every_visits - (vt % r.every_visits)
                            else greatest(s.regular_visits - v90, 0) end) order by r.created_at)
       from rewards r where r.shop_id = p_shop and r.active and r.removed_at is null), '[]'::jsonb),
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

-- Earned notification also names any reward this bill unlocked.
drop function if exists public.push_targets_for_earn(bigint);
create function public.push_targets_for_earn(p_txn bigint)
returns table (token text, shop_id uuid, shop_name text, points int, balance int,
               visits_90d int, regular_visits int, new_visit boolean, rewards text)
language sql stable security definer set search_path = public as $$
  select t.token, s.id, s.name, x.points, _balance(c.id), _visits(c.id, 90), s.regular_visits,
    not exists (select 1 from transactions y where y.customer_id = c.id and y.kind = 'earn' and y.reversed_at is null
                and y.id < x.id and (y.created_at at time zone s.timezone)::date = (x.created_at at time zone s.timezone)::date),
    (select string_agg(g.title, ', ' order by g.id) from reward_grants g where g.txn_id = x.id)
  from transactions x join customers c on c.id = x.customer_id join shops s on s.id = x.shop_id
  join push_tokens t on t.user_id = c.app_user_id
  where x.id = p_txn and x.kind = 'earn' and x.reversed_at is null;
$$;

revoke execute on function public._grant_rewards(), public._take_back_rewards(), public._find_customer(uuid, text, text),
  public.push_targets_for_earn(bigint) from public, anon, authenticated;
grant execute on function public.push_targets_for_earn(bigint) to service_role;
revoke execute on function public.add_reward(uuid, text, text, text, int), public.update_reward(uuid, bigint, text, text, boolean),
  public.remove_reward(uuid, bigint), public.shop_rewards(uuid), public.customer_rewards(uuid, text, text),
  public.use_reward(uuid, bigint) from public, anon;
grant execute on function public.add_reward(uuid, text, text, text, int), public.update_reward(uuid, bigint, text, text, boolean),
  public.remove_reward(uuid, bigint), public.shop_rewards(uuid), public.customer_rewards(uuid, text, text),
  public.use_reward(uuid, bigint) to authenticated;
