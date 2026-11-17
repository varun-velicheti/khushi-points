-- POS: a partial refund also takes back its share of the points the bill gave.
-- Share = points given x (amount refunded so far / bill total), worked out on the running total so rounding never drifts.
-- The bill's earn entry is lowered to what it still stands for, so a later void takes back only the rest.
-- Points the customer has already spent cannot come back; then only what is left in their balance is taken.

alter table public.biz_refunds add column points_back int not null default 0 check (points_back >= 0);

create or replace function public._biz_refund_points(p_order uuid, p_refund uuid)
returns int language plpgsql security definer set search_path = public as $$
declare o biz_orders; t transactions; refunded numeric; keep int; need int; got int := 0; take int; l record;
begin
  select * into o from biz_orders where id = p_order;
  if o.points_txn_id is null or coalesce((o.totals->>'total')::numeric, 0) <= 0 then return 0; end if;
  select * into t from transactions where id = o.points_txn_id for update;
  if not found or t.reversed_at is not null then return 0; end if;
  select coalesce(sum((totals->>'total')::numeric), 0) into refunded from biz_refunds where order_id = p_order;
  keep := greatest(round(o.points_earned * (1 - least(refunded / (o.totals->>'total')::numeric, 1))), 0)::int;
  need := t.points - keep;
  if need <= 0 then return 0; end if;
  perform 1 from customers where id = t.customer_id for update;
  -- from this bill's own packet first, then the newest others (as undo does)
  for l in select id, points_left from point_lots
           where customer_id = t.customer_id and points_left > 0 and expires_at > now()
           order by (txn_id = t.id) desc nulls last, expires_at desc, id desc for update loop
    take := least(l.points_left, need - got);
    update point_lots set points_left = points_left - take where id = l.id;
    got := got + take;
    exit when got = need;
  end loop;
  -- the earn entry now stands for what is kept; nothing kept: it counts as undone
  if keep > 0 then update transactions set points = keep where id = t.id;
  else update transactions set reversed_at = now(), reversed_by = auth.uid() where id = t.id; end if;
  update biz_refunds set points_back = got where id = p_refund;
  return got;
end $$;

create or replace function public.biz_refund_order(p_shop uuid, p_order uuid, p_id uuid, p_lines jsonb, p_mode text, p_reason text default null,
                                                   p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare again boolean;
begin
  perform _biz_as_manager(p_shop, p_approval);
  again := exists (select 1 from biz_refunds where id = p_id and shop_id = p_shop);
  perform _biz_refund_order(p_shop, p_order, p_id, p_lines, p_mode, p_reason);
  if not again then perform _biz_refund_points(p_order, p_id); end if;
  return biz_invoice(p_shop, p_order);
end $$;

-- A void after refunds takes back only the points still on the bill (none if refunds took them all).
create or replace function public.biz_void_order(p_shop uuid, p_order uuid, p_reason text default null, p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _biz_as_manager(p_shop, p_approval);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if found and o.status = 'paid' and exists (select 1 from transactions where id = o.points_txn_id and reversed_at is not null) then
    update biz_orders set points_txn_id = null where id = p_order;   -- nothing left to take back
  end if;
  return _biz_void_order(p_shop, p_order, p_reason);
end $$;

create or replace function public.biz_invoice(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  return _biz_order_json(o) || jsonb_build_object('table', (select name from dining_tables where id = o.table_id),
    'voided_at', o.voided_at, 'void_reason', o.void_reason, 'staff', (select name from biz_staff where id = o.staff_id),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'no', no, 'credit_no', credit_no, 'at', at, 'lines', lines,
        'totals', totals, 'mode', mode, 'reason', reason, 'points_back', points_back) order by no) from biz_refunds where order_id = o.id), '[]'));
end $$;

revoke execute on function public._biz_refund_points(uuid, uuid) from public, anon, authenticated;
