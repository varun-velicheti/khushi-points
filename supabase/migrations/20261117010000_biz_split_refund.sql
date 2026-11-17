-- POS: split payments and partial refunds.
-- Split: one GST invoice paid in parts ([{mode, amount}], adding up to the total). Evenly, by amount or by item
-- are only ways the device works out the parts.
-- Refund: some items of a paid bill go back as a numbered credit note (<invoice>-R1). Counted stock is returned and
-- reports and the GST summary subtract it. Points the bill gave stay (a whole-bill void still takes them back).

-- ---------------------------------------------------------------- split payments

drop function if exists public.biz_pay_order(uuid, uuid, text, text, boolean, int, timestamptz);
create function public.biz_pay_order(p_shop uuid, p_order uuid, p_mode text, p_series text default 'A',
                                    p_consent boolean default false, p_seq int default null, p_paid_at timestamptz default null,
                                    p_payments jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; t jsonb; disc numeric := 0; v_fy text; seq int; inv text; d date; earn jsonb; items text; v_paid timestamptz;
  pays jsonb; p jsonb;
begin
  perform _require_member(p_shop);
  if p_mode not in ('cash', 'upi', 'card') then raise exception 'BAD_PAYMENT'; end if;
  if coalesce(p_series, '') !~ '^[A-Z]{1,2}$' then raise exception 'BAD_SERIES'; end if;
  if p_payments is not null then
    if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 10 then raise exception 'BAD_PAYMENT'; end if;
    for p in select * from jsonb_array_elements(p_payments) loop
      if coalesce(p->>'mode', '') not in ('cash', 'upi', 'card') or jsonb_typeof(p->'amount') <> 'number'
         or (p->>'amount')::numeric <= 0 or (p->>'amount')::numeric <> round((p->>'amount')::numeric, 2) then
        raise exception 'BAD_PAYMENT';
      end if;
    end loop;
  end if;
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
  if p_payments is null then
    pays := jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', t->'total'));
  else
    if (select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x) <> (t->>'total')::numeric then
      raise exception 'PAYMENTS_MISMATCH';
    end if;
    select jsonb_agg(jsonb_build_object('mode', x->>'mode', 'amount', (x->>'amount')::numeric)) into pays from jsonb_array_elements(p_payments) x;
  end if;

  -- paid offline: keep the device's time (not in the future, at most 30 days back)
  v_paid := greatest(least(coalesce(p_paid_at, now()), now()), now() - interval '30 days');
  d := (v_paid at time zone s.timezone)::date;
  v_fy := case when extract(month from d) >= 4 then to_char(d, 'YY') || to_char(d + interval '1 year', 'YY')
               else to_char(d - interval '1 year', 'YY') || to_char(d, 'YY') end;
  if p_seq is not null then
    -- the device numbered this invoice in its own series (works offline)
    if p_seq < 1 or not exists (select 1 from biz_devices where shop_id = p_shop and series = p_series) then raise exception 'BAD_SERIES'; end if;
    inv := p_series || v_fy || '-' || lpad(p_seq::text, 4, '0');
    if exists (select 1 from biz_orders where shop_id = p_shop and invoice_no = inv) then raise exception 'INVOICE_TAKEN'; end if;
    insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, p_seq)
    on conflict (shop_id, fy, series) do update set last = greatest(biz_invoice_counters.last, p_seq);
  else
    insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, 1)
    on conflict (shop_id, fy, series) do update set last = biz_invoice_counters.last + 1
    returning last into seq;
    inv := p_series || v_fy || '-' || lpad(seq::text, 4, '0');
  end if;

  update biz_orders set status = 'paid', paid_at = v_paid, paid_by = auth.uid(), invoice_no = inv, totals = t,
    payments = pays, updated_at = now()
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

-- ---------------------------------------------------------------- refunds

create table public.biz_refunds (
  id         uuid primary key,                                   -- made on the device, so a retry does not refund twice
  shop_id    uuid not null references public.shops(id) on delete cascade,
  order_id   uuid not null references public.biz_orders(id) on delete cascade,
  no         int not null,
  credit_no  text not null,
  lines      jsonb not null,                                     -- order lines with the refunded qty and their index `i`
  totals     jsonb not null,
  mode       text not null check (mode in ('cash', 'upi', 'card')),
  reason     text check (char_length(reason) <= 120),
  by_user    uuid references auth.users(id) on delete set null,
  at         timestamptz not null default now(),
  unique (order_id, no)
);
create index on public.biz_refunds (shop_id, at);
alter table public.biz_refunds enable row level security;

alter table public.biz_stock_moves drop constraint biz_stock_moves_reason_check;
alter table public.biz_stock_moves add constraint biz_stock_moves_reason_check check (reason in ('sale', 'add', 'count', 'void', 'refund'));

-- Quantity already refunded per order line index.
create or replace function public._biz_refunded(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(i, q), '{}') from (
    select rl->>'i' i, sum((rl->>'qty')::numeric) q from biz_refunds r, jsonb_array_elements(r.lines) rl
    where r.order_id = p_order group by 1) x;
$$;

-- p_lines: [{i: line index, qty}]. Owner only, like voiding.
create or replace function public.biz_refund_order(p_shop uuid, p_order uuid, p_id uuid, p_lines jsonb, p_mode text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; done jsonb; x jsonb; idx int; q numeric; rl jsonb := '[]'; gross numeric; share numeric := 0; rt jsonb; n int; r record;
begin
  perform _require_member(p_shop, true);
  if exists (select 1 from biz_refunds where id = p_id and shop_id = p_shop) then return biz_invoice(p_shop, p_order); end if;
  if coalesce(p_mode, '') not in ('cash', 'upi', 'card') then raise exception 'BAD_PAYMENT'; end if;
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'paid' then raise exception 'NOT_PAID'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'BAD_LINES'; end if;

  done := _biz_refunded(p_order);
  for x in select * from jsonb_array_elements(p_lines) loop
    idx := (x->>'i')::int; q := (x->>'qty')::numeric;
    if idx is null or idx < 0 or idx >= jsonb_array_length(o.lines) or q is null or q <= 0 then raise exception 'BAD_LINES'; end if;
    if q + coalesce((done->>idx::text)::numeric, 0) > (o.lines->idx->>'qty')::numeric then raise exception 'REFUND_TOO_MUCH'; end if;
    done := done || jsonb_build_object(idx::text, q + coalesce((done->>idx::text)::numeric, 0));
    rl := rl || jsonb_build_array(o.lines->idx || jsonb_build_object('qty', q, 'i', idx));
  end loop;

  -- points used on the bill lowered every line by the same share; the refund gets the same share off
  gross := (_biz_totals(rl, s.gst_inclusive, 0)->>'items')::numeric;
  if (o.totals->>'items')::numeric > 0 then
    share := round(coalesce((o.totals->>'discount')::numeric, 0) * gross / (o.totals->>'items')::numeric, 2);
  end if;
  rt := _biz_totals(rl, s.gst_inclusive, share);

  select coalesce(max(no), 0) + 1 into n from biz_refunds where order_id = p_order;
  insert into biz_refunds (id, shop_id, order_id, no, credit_no, lines, totals, mode, reason, by_user)
  values (p_id, p_shop, p_order, n, o.invoice_no || '-R' || n, rl, rt, p_mode, nullif(left(trim(coalesce(p_reason, '')), 120), ''), auth.uid());

  -- counted stock goes back
  for r in
    select i.id, sum((l->>'qty')::numeric) qty
    from jsonb_array_elements(rl) l join menu_items i on i.id::text = l->>'item_id'
    where i.shop_id = p_shop and i.track_stock group by i.id
  loop
    update menu_items set stock = stock + r.qty where id = r.id;
    insert into biz_stock_moves (shop_id, item_id, change, reason, order_id, by_user) values (p_shop, r.id, r.qty, 'refund', o.id, auth.uid());
  end loop;
  return biz_invoice(p_shop, p_order);
end $$;

-- Voiding a bill after a refund only returns the stock that has not come back yet.
create or replace function public.biz_void_order(p_shop uuid, p_order uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; rtx bigint; r record; note text := null; back jsonb;
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
  -- counted stock goes back, less what refunds already returned
  back := _biz_refunded(p_order);
  for r in
    select i.id, sum((l->>'qty')::numeric - coalesce((back->>(ord - 1)::text)::numeric, 0)) qty
    from jsonb_array_elements(o.lines) with ordinality as x(l, ord) join menu_items i on i.id::text = l->>'item_id'
    where i.shop_id = p_shop and i.track_stock group by i.id
  loop
    if r.qty > 0 then
      update menu_items set stock = stock + r.qty where id = r.id;
      insert into biz_stock_moves (shop_id, item_id, change, reason, order_id, by_user) values (p_shop, r.id, r.qty, 'void', o.id, auth.uid());
    end if;
  end loop;

  update biz_orders set status = 'void', voided_at = now(), voided_by = auth.uid(),
    void_reason = nullif(left(trim(coalesce(p_reason, '')), 120), ''), points_error = coalesce(note, points_error), updated_at = now()
  where id = p_order returning * into o;
  return _biz_order_json(o) || jsonb_build_object('void_reason', o.void_reason, 'voided_at', o.voided_at);
end $$;

-- Invoice view: also lists its credit notes.
create or replace function public.biz_invoice(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  return _biz_order_json(o) || jsonb_build_object('table', (select name from dining_tables where id = o.table_id),
    'voided_at', o.voided_at, 'void_reason', o.void_reason,
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'no', no, 'credit_no', credit_no, 'at', at, 'lines', lines,
        'totals', totals, 'mode', mode, 'reason', reason) order by no) from biz_refunds where order_id = o.id), '[]'));
end $$;

-- Bills list: split bills say so; refunded amount shown.
create or replace function public.biz_bills(p_shop uuid, p_from date, p_to date, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; q text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform _require_member(p_shop);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'BAD_RANGE'; end if;
  select * into s from shops where id = p_shop;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'invoice_no', o.invoice_no, 'paid_at', o.paid_at, 'status', o.status,
      'total', o.totals->'total', 'mode', case when jsonb_array_length(o.payments) > 1 then 'split' else o.payments->0->>'mode' end,
      'refunded', (select sum((r.totals->>'total')::numeric) from biz_refunds r where r.order_id = o.id),
      'table', (select name from dining_tables where id = o.table_id),
      'items', (select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(o.lines) l),
      'customer', case when o.customer_mobile is not null then 'XXXXXX' || right(o.customer_mobile, 4) when o.customer_member is not null then 'App member' end)
      order by o.paid_at desc)
    from (select * from biz_orders where shop_id = p_shop and status in ('paid', 'void')
            and (paid_at at time zone s.timezone)::date between p_from and p_to
            and (q is null or invoice_no ilike '%' || q || '%' or customer_mobile like '%' || regexp_replace(q, '\D', '', 'g') || '%')
          order by paid_at desc limit 500) o), '[]');
end $$;

-- Reports: refunds (dated when given, of bills not voided) come off sales, GST, items and payment modes.
-- Split bills count each part under its own mode.
create or replace function public.biz_report(p_shop uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'BAD_RANGE'; end if;
  select * into s from shops where id = p_shop;
  return (
    with b as (
      select o.*, (o.paid_at at time zone s.timezone)::date as day from biz_orders o
      where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to),
    rf as (
      select r.*, (r.at at time zone s.timezone)::date as day from biz_refunds r join biz_orders o on o.id = r.order_id
      where r.shop_id = p_shop and o.status = 'paid' and (r.at at time zone s.timezone)::date between p_from and p_to),
    -- every bill (+) and credit note (−) as one signed row
    m as (
      select 1 sign, day, totals, lines from b
      union all select -1, day, totals, lines from rf)
    select jsonb_build_object(
      'bills', (select count(*) from b),
      'sales', (select coalesce(sum(sign * (totals->>'total')::numeric), 0) from m),
      'taxable', (select coalesce(sum(sign * (totals->>'taxable')::numeric), 0) from m),
      'gst', (select coalesce(sum(sign * ((totals->>'cgst')::numeric + (totals->>'sgst')::numeric)), 0) from m),
      'discount', (select coalesce(sum(sign * (totals->>'discount')::numeric), 0) from m),
      'refunds', jsonb_build_object('count', (select count(*) from rf), 'amount', (select coalesce(sum((totals->>'total')::numeric), 0) from rf)),
      'by_mode', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'bills', n, 'amount', amt) order by amt desc) from (
          select mode, count(*) filter (where sign = 1) n, sum(sign * amt) amt from (
            select 1 sign, p->>'mode' mode, (p->>'amount')::numeric amt from b, jsonb_array_elements(b.payments) p
            union all select -1, mode, (totals->>'total')::numeric from rf) y group by 1) x), '[]'),
      'by_rate', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', tx, 'cgst', round(tax / 2, 2), 'sgst', tax - round(tax / 2, 2)) order by rate) from (
          select (r->>'rate')::numeric rate, sum(sign * (r->>'taxable')::numeric) tx, sum(sign * (r->>'tax')::numeric) tax
          from m, jsonb_array_elements(m.totals->'by_rate') r group by 1) x), '[]'),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'bills', n, 'sales', amt) order by day) from (
          select day, count(*) filter (where sign = 1) n, sum(sign * (totals->>'total')::numeric) amt from m group by 1) x), '[]'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'amount', amt) order by amt desc) from (
          select l->>'name' name, sum(sign * (l->>'qty')::numeric) q, sum(sign * (l->>'price')::numeric * (l->>'qty')::numeric) amt
          from m, jsonb_array_elements(m.lines) l group by 1 limit 200) x), '[]'),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_no', invoice_no, 'paid_at', paid_at,
          'mode', case when jsonb_array_length(payments) > 1 then 'split' else payments->0->>'mode' end,
          'taxable', totals->'taxable', 'cgst', totals->'cgst', 'sgst', totals->'sgst', 'discount', totals->'discount',
          'round_off', totals->'round_off', 'total', totals->'total') order by paid_at)
        from (select * from b order by paid_at limit 5000) x), '[]'),
      'credit_notes', coalesce((select jsonb_agg(jsonb_build_object('credit_no', credit_no, 'at', at, 'mode', mode,
          'taxable', totals->'taxable', 'cgst', totals->'cgst', 'sgst', totals->'sgst', 'total', totals->'total') order by at)
        from (select * from rf order by at limit 5000) x), '[]')));
end $$;

revoke execute on function public._biz_refunded(uuid) from public, anon, authenticated;
revoke execute on function public.biz_pay_order(uuid, uuid, text, text, boolean, int, timestamptz, jsonb),
  public.biz_refund_order(uuid, uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.biz_pay_order(uuid, uuid, text, text, boolean, int, timestamptz, jsonb),
  public.biz_refund_order(uuid, uuid, uuid, jsonb, text, text) to authenticated;
