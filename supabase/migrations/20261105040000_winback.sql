-- Win-back notes: one personal note to customers who have not been back in a while.
-- Who: last visit 30-120 days ago, uses the app, still follows the shop,
--      and has not had a note from this shop in the last 60 days.
-- The owner can attach one of their rewards as a welcome-back gift (valid 60 days).
-- A shop can send at most one batch a week. App notification only: no SMS or WhatsApp.

create table public.winbacks (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  message     text not null check (char_length(trim(message)) between 5 and 200),
  reward_id   bigint references public.rewards(id) on delete set null,
  gift_title  text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  recipients  int not null default 0
);
create index on public.winbacks (shop_id, created_at desc);

create table public.winback_recipients (
  winback_id  bigint not null references public.winbacks(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  primary key (winback_id, customer_id)
);
create index on public.winback_recipients (customer_id);
create index on public.winback_recipients (user_id);

alter table public.winbacks enable row level security;
alter table public.winback_recipients enable row level security;

-- Customers a note would reach right now.
create or replace function public._winback_targets(p_shop uuid)
returns table (customer_id uuid, user_id uuid, name text, mobile text, last_visit timestamptz, visits int)
language sql stable security definer set search_path = public as $$
  select c.id, c.app_user_id, c.name, c.mobile, x.last, _visits(c.id)
  from customers c
  join (select t.customer_id, max(t.created_at) last from transactions t
        where t.shop_id = p_shop and t.reversed_at is null group by t.customer_id) x on x.customer_id = c.id
  where c.shop_id = p_shop and c.app_user_id is not null
    and x.last < now() - interval '30 days' and x.last > now() - interval '120 days'
    and exists (select 1 from shop_follows f where f.shop_id = p_shop and f.user_id = c.app_user_id and f.following)
    and not exists (select 1 from winback_recipients r join winbacks w on w.id = r.winback_id
                    where r.customer_id = c.id and w.created_at > now() - interval '60 days');
$$;
revoke execute on function public._winback_targets(uuid) from public, anon, authenticated;

-- Owner: who is missing, who a note would reach, and when the next note can go.
create or replace function public.winback_preview(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lapsed int; reachable int; last_sent timestamptz;
begin
  perform _require_member(p_shop, true);
  select count(*) into lapsed from (select customer_id, max(created_at) last from transactions
    where shop_id = p_shop and reversed_at is null group by customer_id) x
    where last < now() - interval '30 days' and last > now() - interval '120 days';
  select count(*) into reachable from _winback_targets(p_shop);
  select max(created_at) into last_sent from winbacks where shop_id = p_shop;
  return jsonb_build_object(
    'lapsed', lapsed,
    'reachable', reachable,
    'not_reachable', lapsed - reachable,
    'next_allowed', case when last_sent > now() - interval '7 days' then last_sent + interval '7 days' end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'mobile', p.mobile, 'last_visit', p.last_visit, 'visits', p.visits)
        order by p.visits desc, p.last_visit desc)
      from (select * from _winback_targets(p_shop) order by visits desc, last_visit desc limit 30) p), '[]'::jsonb));
end $$;

create or replace function public.send_winback(p_shop uuid, p_message text, p_reward bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w winbacks; r rewards; n int;
begin
  perform _require_member(p_shop, true);
  if exists (select 1 from winbacks where shop_id = p_shop and created_at > now() - interval '7 days') then
    raise exception 'WINBACK_LIMIT';
  end if;
  if p_reward is not null then
    select * into r from rewards where id = p_reward and shop_id = p_shop and removed_at is null;
    if not found then raise exception 'NO_REWARD'; end if;
  end if;
  select count(*) into n from _winback_targets(p_shop);
  if n = 0 then raise exception 'NO_ONE_TO_WIN_BACK'; end if;
  insert into winbacks (shop_id, message, reward_id, gift_title, created_by, recipients)
  values (p_shop, trim(p_message), r.id, r.title, auth.uid(), n) returning * into w;
  insert into winback_recipients (winback_id, customer_id, user_id)
  select w.id, x.customer_id, x.user_id from _winback_targets(p_shop) x;
  update winbacks set recipients = (select count(*) from winback_recipients where winback_id = w.id) where id = w.id;
  if r.id is not null then
    insert into reward_grants (reward_id, shop_id, customer_id, title)
    select r.id, p_shop, x.customer_id, r.title from winback_recipients x where x.winback_id = w.id;
  end if;
  return jsonb_build_object('winback_id', w.id, 'recipients', n);
end $$;

-- Owner: past notes and how many of those customers came back afterwards.
create or replace function public.shop_winbacks(p_shop uuid)
returns table (id bigint, message text, gift_title text, created_at timestamptz, recipients int, came_back int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  return query
  select w.id, w.message, w.gift_title, w.created_at, w.recipients,
    (select count(*)::int from winback_recipients r where r.winback_id = w.id
       and exists (select 1 from transactions t where t.customer_id = r.customer_id and t.kind = 'earn'
                   and t.reversed_at is null and t.created_at > w.created_at))
  from winbacks w where w.shop_id = p_shop order by w.created_at desc limit 10;
end $$;

create or replace function public.push_targets_for_winback(p_winback bigint)
returns table (token text, shop_id uuid, shop_name text, message text, gift_title text)
language sql stable security definer set search_path = public as $$
  select t.token, s.id, s.name, w.message, w.gift_title
  from winbacks w join shops s on s.id = w.shop_id
  join winback_recipients r on r.winback_id = w.id
  join push_tokens t on t.user_id = r.user_id
  where w.id = p_winback;
$$;

-- Customer app shop page: the latest note to me from this shop (last 30 days).
create or replace function public.app_shop_note(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _me_app();
  return (select jsonb_build_object('message', w.message, 'gift_title', w.gift_title, 'created_at', w.created_at)
    from winbacks w join winback_recipients r on r.winback_id = w.id
    where w.shop_id = p_shop and r.user_id = auth.uid() and w.created_at > now() - interval '30 days'
    order by w.created_at desc limit 1);
end $$;

revoke execute on function public.push_targets_for_winback(bigint) from public, anon, authenticated;
grant execute on function public.push_targets_for_winback(bigint) to service_role;
revoke execute on function public.winback_preview(uuid), public.send_winback(uuid, text, bigint), public.shop_winbacks(uuid),
  public.app_shop_note(uuid) from public, anon;
grant execute on function public.winback_preview(uuid), public.send_winback(uuid, text, bigint), public.shop_winbacks(uuid),
  public.app_shop_note(uuid) to authenticated;
