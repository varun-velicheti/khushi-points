-- Khushi Biz step 2: kitchen tickets (KOT) and the Kitchen screen.
-- "Send to kitchen" turns whatever changed since the last send into a numbered ticket:
-- new items as positive quantities, reduced or removed items as negative ("cancel") lines.
-- The kitchen moves tickets new -> cooking -> ready -> done.

create table public.biz_tickets (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  order_id   uuid not null references public.biz_orders(id) on delete cascade,
  no         int not null,                       -- per shop, restarts each day
  lines      jsonb not null,                     -- [{key, name, qty, note}], qty < 0 means cancel
  status     text not null default 'new' check (status in ('new', 'cooking', 'ready', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.biz_tickets (shop_id, status, created_at);
create index on public.biz_tickets (order_id);
alter table public.biz_tickets enable row level security;

-- A line's identity for the kitchen: the same item with the same note is one dish.
create or replace function public._biz_line_key(l jsonb)
returns text language sql immutable as $$
  select coalesce(l->>'item_id', l->>'name') || '|' || coalesce(l->>'note', '');
$$;

-- Quantity already sent to the kitchen per line key.
create or replace function public._biz_sent(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, q) filter (where q <> 0), '{}') from (
    select tl->>'key' k, sum((tl->>'qty')::numeric) q
    from biz_tickets t, jsonb_array_elements(t.lines) tl where t.order_id = p_order group by 1) x;
$$;

-- Order JSON now also says what the kitchen already has, and how far along the kitchen is.
create or replace function public._biz_order_json(o biz_orders)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'kind', o.kind, 'table_id', o.table_id, 'status', o.status, 'lines', o.lines,
    'customer_mobile', o.customer_mobile, 'customer_member', o.customer_member, 'customer_name', o.customer_name,
    'redeem_request_id', o.redeem_request_id, 'opened_at', o.opened_at, 'updated_at', o.updated_at,
    'paid_at', o.paid_at, 'invoice_no', o.invoice_no, 'totals', o.totals, 'payments', o.payments,
    'points_earned', o.points_earned, 'points_error', o.points_error,
    'sent', _biz_sent(o.id),
    -- the kitchen state that needs attention first: ready (to serve), then cooking, then new
    'kitchen', (select t.status from biz_tickets t where t.order_id = o.id and t.status <> 'done'
                order by case t.status when 'ready' then 0 when 'cooking' then 1 else 2 end limit 1));
$$;

create or replace function public.biz_send_to_kitchen(p_shop uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; sent jsonb; diff jsonb; n int; tk biz_tickets;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'ORDER_CLOSED'; end if;
  sent := _biz_sent(p_order);
  -- now (per key) minus already sent
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'name', name, 'note', note, 'qty', q - coalesce((sent->>k)::numeric, 0))
           order by first) filter (where q - coalesce((sent->>k)::numeric, 0) <> 0), '[]')
  into diff from (
    select _biz_line_key(l) k, min(l->>'name') name, min(l->>'note') note, sum((l->>'qty')::numeric) q, min(ord) first
    from jsonb_array_elements(o.lines) with ordinality as x(l, ord) group by 1) cur;
  -- items sent before and now gone completely (name and note from the earlier ticket)
  select diff || coalesce(jsonb_agg(jsonb_build_object('key', e.k,
           'name', (select tl->>'name' from biz_tickets t, jsonb_array_elements(t.lines) tl where t.order_id = p_order and tl->>'key' = e.k limit 1),
           'note', nullif(split_part(e.k, '|', 2), ''), 'qty', -(e.v::numeric))), '[]')
  into diff from jsonb_each_text(sent) e(k, v)
  where not exists (select 1 from jsonb_array_elements(o.lines) l where _biz_line_key(l) = e.k);
  if jsonb_array_length(diff) = 0 then return null; end if;

  perform pg_advisory_xact_lock(hashtext('biz_ticket_' || p_shop::text));
  select coalesce(max(no), 0) + 1 into n from biz_tickets
  where shop_id = p_shop and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
  insert into biz_tickets (shop_id, order_id, no, lines) values (p_shop, p_order, n, diff) returning * into tk;
  return jsonb_build_object('id', tk.id, 'no', tk.no, 'lines', tk.lines);
end $$;

-- Tickets the kitchen still has to deal with.
create or replace function public.biz_kitchen(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'no', t.no, 'lines', t.lines, 'status', t.status,
      'created_at', t.created_at, 'updated_at', t.updated_at, 'order_id', t.order_id, 'kind', o.kind,
      'table', (select name from dining_tables where id = o.table_id), 'cancelled', o.status = 'cancelled') order by t.created_at)
    from biz_tickets t join biz_orders o on o.id = t.order_id
    where t.shop_id = p_shop and t.status <> 'done' and t.created_at > now() - interval '1 day'), '[]');
end $$;

create or replace function public.biz_ticket_status(p_shop uuid, p_ticket uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  if p_status not in ('new', 'cooking', 'ready', 'done') then raise exception 'BAD_STATUS'; end if;
  update biz_tickets set status = p_status, updated_at = now() where id = p_ticket and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke execute on function public._biz_line_key(jsonb), public._biz_sent(uuid) from public, anon, authenticated;
revoke execute on function public.biz_send_to_kitchen(uuid, uuid), public.biz_kitchen(uuid), public.biz_ticket_status(uuid, uuid, text) from public, anon;
grant execute on function public.biz_send_to_kitchen(uuid, uuid), public.biz_kitchen(uuid), public.biz_ticket_status(uuid, uuid, text) to authenticated;
