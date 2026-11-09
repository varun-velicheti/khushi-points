-- Khushi Biz: points used on a bill are tied to the order from the moment the cashier asks.
-- * biz_start_redemption links the request to the order straight away (no lost approvals).
-- * Removing the discount or cancelling the order gives approved points back to the customer.
-- * Paying while the customer has not answered yet is refused; a declined or expired request is dropped.

-- Undo the points request linked to an order: cancel it if still waiting, give points back if approved.
create or replace function public._biz_release_redemption(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o biz_orders; r redeem_requests; s shops; t transactions;
begin
  select * into o from biz_orders where id = p_order for update;
  if o.redeem_request_id is null then return; end if;
  select * into r from redeem_requests where id = o.redeem_request_id for update;
  if r.status = 'pending' then
    update redeem_requests set status = 'cancelled', decided_at = now() where id = r.id;
  elsif r.status = 'done' and r.txn_id is not null then
    select * into t from transactions where id = r.txn_id for update;
    if t.reversed_at is null then
      select * into s from shops where id = t.shop_id;
      insert into point_lots (shop_id, customer_id, points, points_left, expires_at, txn_id)
      values (t.shop_id, t.customer_id, t.points, t.points, now() + make_interval(days => s.expiry_days), t.id);
      update transactions set reversed_at = now(), reversed_by = auth.uid() where id = t.id;
    end if;
  end if;
  update biz_orders set redeem_request_id = null, updated_at = now() where id = p_order;
end $$;

-- Ask the customer (in their app) to use p_points on this order.
create or replace function public.biz_start_redemption(p_shop uuid, p_order uuid, p_points int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; res jsonb;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if o.customer_mobile is null and o.customer_member is null then raise exception 'NO_CUSTOMER'; end if;
  perform _biz_release_redemption(p_order);
  res := start_redemption(p_shop, o.customer_mobile, o.customer_member,
    (_biz_totals(o.lines, s.gst_inclusive, 0)->>'total')::numeric, p_points);
  update biz_orders set redeem_request_id = (res->>'request_id')::uuid, updated_at = now() where id = p_order;
  return res;
end $$;

-- p_request null: take the points discount off (and give approved points back).
create or replace function public.biz_use_redemption(p_shop uuid, p_order uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; r redeem_requests;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if p_request is null or p_request is distinct from o.redeem_request_id then perform _biz_release_redemption(p_order); end if;
  if p_request is not null and p_request is distinct from o.redeem_request_id then
    select * into r from redeem_requests where id = p_request and shop_id = p_shop;
    if not found or r.status <> 'done' then raise exception 'REDEEM_NOT_APPROVED'; end if;
    update biz_orders set redeem_request_id = p_request, updated_at = now() where id = p_order;
  end if;
  select * into o from biz_orders where id = p_order;
  return _biz_order_json(o);
end $$;

create or replace function public.biz_cancel_order(p_shop uuid, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  if not exists (select 1 from biz_orders where id = p_order and shop_id = p_shop and status = 'open') then return; end if;
  perform _biz_release_redemption(p_order);
  update biz_orders set status = 'cancelled', updated_at = now() where id = p_order;
end $$;

-- Saving an order with a different customer undoes the old customer's points request.
create or replace function public.biz_save_order(p_shop uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; oid uuid := (p->>'id')::uuid; tbl uuid := nullif(p->>'table_id', '')::uuid;
begin
  perform _require_member(p_shop);
  if oid is null then raise exception 'BAD_ORDER'; end if;
  select * into o from biz_orders where id = oid for update;
  if found and o.shop_id <> p_shop then raise exception 'NOT_FOUND'; end if;
  if found and o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  -- a different customer: the points request belongs to the old one, so undo it
  if found and o.redeem_request_id is not null
     and (o.customer_mobile is distinct from case when nullif(trim(coalesce(p->>'customer_mobile', '')), '') is not null then _clean_mobile(p->>'customer_mobile') end
          or o.customer_member is distinct from nullif(trim(coalesce(p->>'customer_member', '')), '')) then
    perform _biz_release_redemption(oid);
  end if;
  if tbl is not null and not exists (select 1 from dining_tables where id = tbl and shop_id = p_shop and archived_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  begin
    insert into biz_orders (id, shop_id, kind, table_id, lines, customer_mobile, customer_member, customer_name, opened_by)
    values (oid, p_shop, coalesce(p->>'kind', 'dine_in'), tbl, _biz_clean_lines(p->'lines'),
      case when nullif(trim(coalesce(p->>'customer_mobile', '')), '') is not null then _clean_mobile(p->>'customer_mobile') end,
      nullif(trim(coalesce(p->>'customer_member', '')), ''),
      nullif(trim(coalesce(p->>'customer_name', '')), ''), auth.uid())
    on conflict (id) do update set kind = excluded.kind, table_id = excluded.table_id, lines = excluded.lines,
      customer_mobile = excluded.customer_mobile, customer_member = excluded.customer_member,
      customer_name = excluded.customer_name, updated_at = now()
    returning * into o;
  exception when unique_violation then
    raise exception 'TABLE_BUSY';
  end;
  return _biz_order_json(o);
end $$;

-- Before paying: a waiting request blocks payment; a declined/expired one is dropped.
create or replace function public._biz_settle_redemption(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select r.status into st from biz_orders o join redeem_requests r on r.id = o.redeem_request_id where o.id = p_order;
  if st = 'pending' then raise exception 'REDEEM_PENDING'; end if;
  if st is not null and st <> 'done' then update biz_orders set redeem_request_id = null where id = p_order; end if;
end $$;

create or replace function public.biz_pay_order(p_shop uuid, p_order uuid, p_mode text, p_series text default 'A',
                                               p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; t jsonb; disc numeric := 0; v_fy text; seq int; inv text; d date; earn jsonb; items text;
begin
  perform _require_member(p_shop);
  if p_mode not in ('cash', 'upi', 'card') then raise exception 'BAD_PAYMENT'; end if;
  if coalesce(p_series, '') !~ '^[A-Z]{1,2}$' then raise exception 'BAD_SERIES'; end if;
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'paid' then return _biz_order_json(o); end if;
  if o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if jsonb_array_length(o.lines) = 0 then raise exception 'EMPTY_ORDER'; end if;
  perform _biz_settle_redemption(p_order);
  select * into o from biz_orders where id = p_order;

  select r.points * s.point_value into disc from redeem_requests r where r.id = o.redeem_request_id and r.status = 'done';
  t := _biz_totals(o.lines, s.gst_inclusive, coalesce(disc, 0));

  d := (now() at time zone s.timezone)::date;
  v_fy := case when extract(month from d) >= 4 then to_char(d, 'YY') || to_char(d + interval '1 year', 'YY')
               else to_char(d - interval '1 year', 'YY') || to_char(d, 'YY') end;
  insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, 1)
  on conflict (shop_id, fy, series) do update set last = biz_invoice_counters.last + 1
  returning last into seq;
  inv := p_series || v_fy || '-' || lpad(seq::text, 4, '0');

  update biz_orders set status = 'paid', paid_at = now(), paid_by = auth.uid(), invoice_no = inv, totals = t,
    payments = jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', t->'total')), updated_at = now()
  where id = p_order returning * into o;

  if (o.customer_mobile is not null or o.customer_member is not null) and (t->>'total')::numeric > 0 then
    select string_agg(trim(to_char((l->>'qty')::numeric, 'FM999990.##')) || ' ' || (l->>'name'), ', ')
    into items from jsonb_array_elements(o.lines) l;
    begin
      earn := add_bill(p_shop, o.customer_mobile, inv, (t->>'total')::numeric, o.customer_name, p_consent, o.customer_member, left(items, 300));
      update biz_orders set points_txn_id = (earn->>'txn_id')::bigint, points_earned = (earn->>'points')::int
      where id = p_order returning * into o;
    exception when others then
      update biz_orders set points_error = sqlerrm where id = p_order returning * into o;
    end;
  end if;
  return _biz_order_json(o) || jsonb_build_object('txn_id', o.points_txn_id);
end $$;

revoke execute on function public._biz_release_redemption(uuid), public._biz_settle_redemption(uuid) from public, anon, authenticated;
revoke execute on function public.biz_start_redemption(uuid, uuid, int) from public, anon;
grant execute on function public.biz_start_redemption(uuid, uuid, int) to authenticated;
