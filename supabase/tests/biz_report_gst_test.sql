-- POS reports: previous period, sales by hour, GSTR-1 (HSN summary, documents issued), net of refunds.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); end $$;
create function t.expect_error(q text, code text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected % but statement succeeded: %', code, q;
exception when others then
  if sqlerrm not like '%' || code || '%' then raise exception 'expected %, got %  (%)', code, sqlerrm, q; end if;
end $$;
create function t.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'CHECK FAILED: %', msg; end if; end $$;
grant usage on schema t to public;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'owner@cafe.in');
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Chai Adda')).id as shop \gset
reset role;
update public.shops set biz_enabled = true, gst_inclusive = true, gstin = '36ABCDE1234F1Z5' where id = :'shop';
select (now() at time zone timezone)::date as today, (now() at time zone timezone)::date - 1 as yday,
       extract(hour from now() at time zone timezone)::int as hr from public.shops where id = :'shop' \gset
set role authenticated;
select public.biz_claim_series(:'shop', 'Counter', 'A');
-- today: 2 chai (HSN 0902) + 1 biryani (no HSN) = 240
\set o1 'cccccccc-0000-0000-0000-000000000001'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o1', 'kind', 'takeaway', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Chai', 'price', 30, 'qty', 2, 'gst_rate', 5, 'hsn', '0902'),
  jsonb_build_object('name', 'Biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));
select public.biz_pay_order(:'shop', :'o1', 'cash', 'A', false, 1, null);
-- yesterday: 1 biryani = 180 (paid offline, kept the device's time)
\set o2 'cccccccc-0000-0000-0000-000000000002'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o2', 'kind', 'takeaway', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));
select public.biz_pay_order(:'shop', :'o2', 'upi', 'A', false, 2, now() - interval '1 day');
-- today, then voided
\set o3 'cccccccc-0000-0000-0000-000000000003'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o3', 'kind', 'takeaway', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Chai', 'price', 30, 'qty', 1, 'gst_rate', 5, 'hsn', '0902'))));
select public.biz_pay_order(:'shop', :'o3', 'cash', 'A', false, 3, null);
select public.biz_void_order(:'shop', :'o3', 'mistake');
-- refund 1 chai of today's bill
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash');

select public.biz_report(:'shop', :'today', :'today') as r \gset
select t.check(((:'r'::jsonb)->>'sales')::numeric = 210, 'today net of refund');
select t.check(((:'r'::jsonb)->'previous'->>'sales')::numeric = 180 and (:'r'::jsonb)->'previous'->>'from' = :'yday', 'previous day');
select t.check(jsonb_array_length((:'r'::jsonb)->'by_hour') = 1 and ((:'r'::jsonb)->'by_hour'->0->>'hour')::int = :hr
  and ((:'r'::jsonb)->'by_hour'->0->>'bills')::int = 1, 'one paid bill this hour (void left out)');
select t.check((:'r'::jsonb)->'gstr1'->>'state' = '36', 'state from GSTIN');
select t.check((select (h->>'qty')::numeric = 1 and (h->>'value')::numeric = 30 and (h->>'taxable')::numeric = 28.57
  from jsonb_array_elements((:'r'::jsonb)->'gstr1'->'hsn') h where h->>'hsn' = '0902'), 'HSN 0902 net of refund');
select t.check((select (h->>'value')::numeric = 180 and (h->>'taxable')::numeric = 171.43 and (h->>'tax')::numeric = 8.57
  from jsonb_array_elements((:'r'::jsonb)->'gstr1'->'hsn') h where h->>'hsn' = '996331'), 'no HSN reported as 996331');
select t.check((select sum((h->>'value')::numeric) from jsonb_array_elements((:'r'::jsonb)->'gstr1'->'hsn') h) = ((:'r'::jsonb)->>'sales')::numeric, 'HSN adds up to sales');
select t.check((select (d->>'total')::int = 2 and (d->>'cancelled')::int = 1 and d->>'from' like 'A%-0001' and d->>'to' like 'A%-0003'
  from jsonb_array_elements((:'r'::jsonb)->'gstr1'->'docs') d where d->>'kind' = 'invoice'), 'invoices issued today, one cancelled');
select t.check((select (d->>'total')::int = 1 from jsonb_array_elements((:'r'::jsonb)->'gstr1'->'docs') d where d->>'kind' = 'credit'), 'one credit note');
-- yesterday on its own: no credit notes, previous day empty
select public.biz_report(:'shop', :'yday', :'yday') as y \gset
select t.check(((:'y'::jsonb)->'previous'->>'sales')::numeric = 0 and not exists (
  select 1 from jsonb_array_elements((:'y'::jsonb)->'gstr1'->'docs') d where d->>'kind' = 'credit'), 'yesterday alone');
reset role;
select 'ALL TESTS PASSED' as result;
