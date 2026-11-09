-- Khushi Biz: bill history and voiding a paid bill (owner).
-- A voided bill keeps its invoice number (GST: cancelled invoices stay in the register), drops out of reports,
-- takes back the points it gave, returns points the customer used on it, and puts counted stock back.

alter table public.biz_orders drop constraint biz_orders_status_check;
alter table public.biz_orders add constraint biz_orders_status_check check (status in ('open', 'paid', 'cancelled', 'void'));
alter table public.biz_orders add column voided_at timestamptz, add column voided_by uuid references auth.users(id) on delete set null,
  add column void_reason text check (char_length(void_reason) <= 120);
alter table public.biz_stock_moves drop constraint biz_stock_moves_reason_check;
alter table public.biz_stock_moves add constraint biz_stock_moves_reason_check check (reason in ('sale', 'add', 'count', 'void'));

create or replace function public.biz_void_order(p_shop uuid, p_order uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; rtx bigint; r record; note text := null;
begin
  perform _require_member(p_shop, true);
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'void' then return _biz_order_json(o); end if;
  if o.status <> 'paid' then raise exception 'NOT_PAID'; end if;

  -- points this bill gave
  if o.points_txn_id is not null then
    begin perform reverse_transaction(p_shop, o.points_txn_id);
    exception when others then note := 'Points could not be taken back: ' || sqlerrm; end;
  end if;
  -- points the customer used on this bill
  select txn_id into rtx from redeem_requests where id = o.redeem_request_id and status = 'done';
  if rtx is not null then
    begin perform reverse_transaction(p_shop, rtx);
    exception when others then null; end;
  end if;
  -- counted stock goes back
  for r in
    select i.id, sum((l->>'qty')::numeric) qty
    from jsonb_array_elements(o.lines) l join menu_items i on i.id::text = l->>'item_id'
    where i.shop_id = p_shop and i.track_stock group by i.id
  loop
    update menu_items set stock = stock + r.qty where id = r.id;
    insert into biz_stock_moves (shop_id, item_id, change, reason, order_id, by_user) values (p_shop, r.id, r.qty, 'void', o.id, auth.uid());
  end loop;

  update biz_orders set status = 'void', voided_at = now(), voided_by = auth.uid(),
    void_reason = nullif(left(trim(coalesce(p_reason, '')), 120), ''), points_error = coalesce(note, points_error), updated_at = now()
  where id = p_order returning * into o;
  return _biz_order_json(o) || jsonb_build_object('void_reason', o.void_reason, 'voided_at', o.voided_at);
end $$;

-- Bills (paid and void) for a date range, newest first; search by invoice number or customer mobile.
create or replace function public.biz_bills(p_shop uuid, p_from date, p_to date, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; q text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform _require_member(p_shop);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'BAD_RANGE'; end if;
  select * into s from shops where id = p_shop;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'invoice_no', o.invoice_no, 'paid_at', o.paid_at, 'status', o.status,
      'total', o.totals->'total', 'mode', o.payments->0->>'mode', 'table', (select name from dining_tables where id = o.table_id),
      'items', (select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(o.lines) l),
      'customer', case when o.customer_mobile is not null then 'XXXXXX' || right(o.customer_mobile, 4) when o.customer_member is not null then 'App member' end)
      order by o.paid_at desc)
    from (select * from biz_orders where shop_id = p_shop and status in ('paid', 'void')
            and (paid_at at time zone s.timezone)::date between p_from and p_to
            and (q is null or invoice_no ilike '%' || q || '%' or customer_mobile like '%' || regexp_replace(q, '\D', '', 'g') || '%')
          order by paid_at desc limit 500) o), '[]');
end $$;

-- Invoice view: also says when and why a bill was voided.
create or replace function public.biz_invoice(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  return _biz_order_json(o) || jsonb_build_object('table', (select name from dining_tables where id = o.table_id),
    'voided_at', o.voided_at, 'void_reason', o.void_reason);
end $$;

revoke execute on function public.biz_void_order(uuid, uuid, text), public.biz_bills(uuid, date, date, text) from public, anon;
grant execute on function public.biz_void_order(uuid, uuid, text), public.biz_bills(uuid, date, date, text) to authenticated;
