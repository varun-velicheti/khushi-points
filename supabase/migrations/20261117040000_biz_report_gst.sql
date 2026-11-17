-- POS reports: the previous period for comparison, sales by hour, and what GSTR-1 needs
-- (B2C sales by rate, HSN summary and documents issued), all net of refunds.
-- Items without an HSN code are reported under SAC 996331 (restaurant service).

create or replace function public.biz_report(p_shop uuid, p_from date, p_to date, p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops; days int := p_to - p_from + 1; prev jsonb;
begin
  perform _biz_as_manager(p_shop, p_approval);
  select * into s from shops where id = p_shop;
  prev := _biz_report(p_shop, p_from - days, p_from - 1);
  return _biz_report(p_shop, p_from, p_to) || jsonb_build_object(
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(st.name, 'Not set'), 'bills', n, 'sales', amt) order by amt desc) from (
        select o.staff_id, count(*) n, sum((o.totals->>'total')::numeric) amt from biz_orders o
        where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to
        group by 1) x left join biz_staff st on st.id = x.staff_id), '[]'),
    'previous', jsonb_build_object('from', p_from - days, 'to', p_from - 1, 'sales', prev->'sales', 'bills', prev->'bills'),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'bills', n, 'sales', amt) order by h) from (
        select extract(hour from o.paid_at at time zone s.timezone)::int h, count(*) n, sum((o.totals->>'total')::numeric) amt
        from biz_orders o
        where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to
        group by 1) x), '[]'),
    'gstr1', jsonb_build_object(
      'state', left(s.gstin, 2),
      'hsn', coalesce((
        with ln as (
          select 1 sign, o.totals, l from biz_orders o, jsonb_array_elements(o.lines) l
          where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to
          union all
          select -1, r.totals, l from biz_refunds r join biz_orders o on o.id = r.order_id, jsonb_array_elements(r.lines) l
          where r.shop_id = p_shop and o.status = 'paid' and (r.at at time zone s.timezone)::date between p_from and p_to),
        v as (
          -- each line's share of what was actually paid (points lower every line alike), GST included
          select coalesce(nullif(l->>'hsn', ''), '996331') hsn, (l->>'gst_rate')::numeric rate, sign * (l->>'qty')::numeric qty,
            sign * (l->>'price')::numeric * (l->>'qty')::numeric * case when s.gst_inclusive then 1 else 1 + (l->>'gst_rate')::numeric / 100 end
              * case when (totals->>'items')::numeric > 0
                     then ((totals->>'items')::numeric - coalesce((totals->>'discount')::numeric, 0)) / (totals->>'items')::numeric else 0 end amount
          from ln)
        select jsonb_agg(jsonb_build_object('hsn', hsn, 'rate', rate, 'qty', q, 'value', round(a, 2),
            'taxable', round(a / (1 + rate / 100), 2), 'tax', round(a, 2) - round(a / (1 + rate / 100), 2)) order by hsn, rate)
        from (select hsn, rate, sum(qty) q, sum(amount) a from v group by 1, 2) x), '[]'),
      'docs', coalesce((
        select jsonb_agg(jsonb_build_object('kind', kind, 'from', mn, 'to', mx, 'total', n, 'cancelled', c) order by kind, mn) from (
          select 'invoice' kind, substring(invoice_no from '^([A-Z]{1,2}[0-9]{4})-') ser, min(invoice_no) mn, max(invoice_no) mx,
                 count(*) n, count(*) filter (where status = 'void') c
          from biz_orders where shop_id = p_shop and status in ('paid', 'void') and (paid_at at time zone s.timezone)::date between p_from and p_to
          group by 2
          union all
          select 'credit', null, min(credit_no), max(credit_no), count(*), 0
          from biz_refunds where shop_id = p_shop and (at at time zone s.timezone)::date between p_from and p_to
          having count(*) > 0) x), '[]')));
end $$;
