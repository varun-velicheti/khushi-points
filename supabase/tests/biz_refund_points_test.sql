-- POS: partial refunds take back their share of points; a later void takes the rest.
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
update public.shops set biz_enabled = true, gst_inclusive = true, earn_pct = 10 where id = :'shop';
set role authenticated;
select public.biz_claim_series(:'shop', 'Counter', 'A');
\set o1 'cccccccc-0000-0000-0000-000000000001'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o1', 'kind', 'takeaway', 'customer_mobile', '9848012345', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Chai', 'price', 30, 'qty', 4, 'gst_rate', 5),
  jsonb_build_object('name', 'Biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));
select (public.biz_pay_order(:'shop', :'o1', 'cash', 'A', true))->>'points_earned' as pts \gset
select t.check(:pts = 30, 'earned 30 points on 300');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 30, 'balance 30');

-- refund 1 chai (30 of 300): 3 points back
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash') as inv \gset
select t.check(((:'inv'::jsonb)->'refunds'->0->>'points_back')::int = 3, '3 points back');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 27, 'balance 27');
-- the same refund again takes nothing more
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 27, 'retry takes nothing');
-- the other 3 chai (90 more; 120 of 300 refunded): keep 18, so 9 more back
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000002', '[{"i":0,"qty":3}]', 'cash') as inv2 \gset
select t.check(((:'inv2'::jsonb)->'refunds'->1->>'points_back')::int = 9, '9 more back');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 18, 'balance 18');
reset role;
select t.check((select points from public.transactions where kind = 'earn') = 18, 'earn entry now 18');
set role authenticated;
-- void takes back the 18 left
select public.biz_void_order(:'shop', :'o1', 'test');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 0, 'void takes the rest');

-- a bill refunded in full: all points back, and a void after it is fine
\set o2 'cccccccc-0000-0000-0000-000000000002'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o2', 'kind', 'takeaway', 'customer_mobile', '9848012345', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));
select public.biz_pay_order(:'shop', :'o2', 'cash', 'A', true);
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 18, 'earned 18');
select public.biz_refund_order(:'shop', :'o2', 'dddddddd-0000-0000-0000-000000000003', '[{"i":0,"qty":1}]', 'cash');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 0, 'full refund takes all');
select t.check(((public.biz_void_order(:'shop', :'o2', 'x'))->>'points_error') is null, 'void after full refund has no points error');

-- points already spent: only what is left comes back
\set o3 'cccccccc-0000-0000-0000-000000000003'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o3', 'kind', 'takeaway', 'customer_mobile', '9848012345', 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Biryani', 'price', 180, 'qty', 2, 'gst_rate', 5))));
select public.biz_pay_order(:'shop', :'o3', 'cash', 'A', true);
reset role;
update public.point_lots set points_left = 5 where points_left > 0;
set role authenticated;
select public.biz_refund_order(:'shop', :'o3', 'dddddddd-0000-0000-0000-000000000004', '[{"i":0,"qty":1}]', 'cash') as inv3 \gset
select t.check(((:'inv3'::jsonb)->'refunds'->0->>'points_back')::int = 5, 'only 5 left to take');
select t.check(((public.customer_balance(:'shop', '9848012345'))->>'balance')::int = 0, 'balance never below 0');
reset role;
select 'ALL TESTS PASSED' as result;
