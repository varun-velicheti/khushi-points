-- Khushi Biz step 1: menu, orders, GST bill, payment, points. Fresh database with shim + migrations.
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
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@cafe.in'),
  ('22222222-2222-2222-2222-222222222222', 'cashier@cafe.in'),
  ('33333333-3333-3333-3333-333333333333', 'owner@other.in'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p917353862216@phone.khushipoints.app');
set role service_role;
select public.app_attach_phone('cccccccc-cccc-cccc-cccc-cccccccccccc', '7353862216');
reset role;

-- GST maths (inclusive prices): 2 x 105 at 5% + 1 x 118 at 18% = 328
select t.check((public._biz_totals('[{"price":105,"qty":2,"gst_rate":5},{"price":118,"qty":1,"gst_rate":18}]', true))->>'total' = '328', 'inclusive total');
select t.check((public._biz_totals('[{"price":105,"qty":2,"gst_rate":5},{"price":118,"qty":1,"gst_rate":18}]', true))->>'taxable' = '300.00', 'inclusive taxable');
select t.check((public._biz_totals('[{"price":105,"qty":2,"gst_rate":5},{"price":118,"qty":1,"gst_rate":18}]', true))->>'cgst' = '14.00', 'cgst half of tax');
-- exclusive: 2 x 100 at 5% = 210
select t.check((public._biz_totals('[{"price":100,"qty":2,"gst_rate":5}]', false))->>'total' = '210', 'exclusive adds gst');
-- discount 28 off 328 -> 300, tax charged on what is paid
select t.check((public._biz_totals('[{"price":105,"qty":2,"gst_rate":5},{"price":118,"qty":1,"gst_rate":18}]', true, 28))->>'total' = '300', 'discount');
-- rounding: 99.50 -> 100 with round off 0.50
select t.check((public._biz_totals('[{"price":99.5,"qty":1,"gst_rate":0}]', true))->>'round_off' = '0.50', 'round off');
select t.check((public._biz_totals('[]', true))->>'total' = '0', 'empty');

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Chai Adda')).id as shop \gset
reset role;
update public.shops set biz_enabled = true where id = :'shop';
set role authenticated;
select join_code as code from public.shops where id = :'shop' \gset
select public.biz_save_settings(:'shop', '{"gstin":"36abcde1234f1z5","legal_name":"Chai Adda LLP","upi_id":"chaiadda@okhdfc"}');
select t.check((public.biz_menu(:'shop'))->'shop'->>'gstin' = '36ABCDE1234F1Z5', 'gstin saved uppercase');
select t.expect_error($$ select public.biz_save_settings('$$ || :'shop' || $$', '{"gstin":"bad"}') $$, 'check constraint');
select public.biz_save_category(:'shop', null, 'Tea', 1) as tea \gset
select public.biz_save_item(:'shop', jsonb_build_object('name','Masala chai','price',30,'gst_rate',5,'category_id',:'tea')) as chai \gset
select public.biz_save_item(:'shop', jsonb_build_object('name','Bun maska','price',45,'gst_rate',5,'veg',true)) as bun \gset
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":10,"gst_rate":7}') $$, 'check constraint');
select public.biz_save_table(:'shop', null, 'T1', 1) as t1 \gset
select public.biz_save_table(:'shop', null, 'T2', 2) as t2 \gset
select t.check(jsonb_array_length((public.biz_menu(:'shop'))->'items') = 2, 'menu has 2 items');
select public.biz_archive_item(:'shop', :'bun');
select t.check(jsonb_array_length((public.biz_menu(:'shop'))->'items') = 1, 'archived item hidden');
reset role;

-- cashier: can take orders and mark sold out, cannot edit the menu
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":10}') $$, 'OWNER_ONLY');
select public.biz_set_available(:'shop', :'chai', false);
select t.check(((public.biz_menu(:'shop'))->'items'->0->>'available')::boolean = false, 'sold out');
select public.biz_set_available(:'shop', :'chai', true);

-- order at T1, saved twice (same id) is still one order
select public.biz_save_order(:'shop', jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000000001','table_id',:'t1',
  'lines', '[{"item_id":null,"name":"Masala chai","price":30,"qty":2,"gst_rate":5}]'::jsonb));
select public.biz_save_order(:'shop', jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000000001','table_id',:'t1',
  'lines', '[{"name":"Masala chai","price":30,"qty":3,"gst_rate":5}]'::jsonb, 'customer_mobile', '73538 62216'));
select t.check(jsonb_array_length(public.biz_open_orders(:'shop')) = 1, 'one open order');
select t.check((public.biz_open_orders(:'shop'))->0->>'total' = '90', 'running total');
-- a second order cannot take T1
select t.expect_error($$ select public.biz_save_order('$$ || :'shop' || $$', jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000000002','table_id','$$ || :'t1' || $$','lines','[]'::jsonb)) $$, 'TABLE_BUSY');
select t.expect_error($$ select public.biz_save_order('$$ || :'shop' || $$', '{"id":"aaaaaaaa-0000-0000-0000-000000000003","lines":[{"name":"x","price":1,"qty":0,"gst_rate":5}]}') $$, 'BAD_LINES');
select t.check((public.biz_preview(:'shop', 'aaaaaaaa-0000-0000-0000-000000000001'))->>'total' = '90', 'preview');

-- pay: invoice number, points for the customer; paying again returns the same invoice
select public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000001', 'upi') as paid \gset
select t.check((:'paid'::jsonb)->>'status' = 'paid', 'paid');
select t.check((:'paid'::jsonb)->>'invoice_no' ~ '^A[0-9]{4}-0001$', 'first invoice number');
select t.check(((:'paid'::jsonb)->>'points_earned')::int = 1, '2% of 90 = 1 point');
select t.check((public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000001', 'cash'))->>'invoice_no' = (:'paid'::jsonb)->>'invoice_no', 'pay twice, same invoice');
select t.check((select count(*) from public.biz_invoice_counters) = 0, 'counters hidden');
select t.expect_error($$ select public.biz_save_order('$$ || :'shop' || $$', '{"id":"aaaaaaaa-0000-0000-0000-000000000001","lines":[]}') $$, 'ORDER_CLOSED');
select t.check(jsonb_array_length(public.biz_open_orders(:'shop')) = 0, 'table free again');

-- takeaway without customer, empty order cannot be paid, next invoice number
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000004","kind":"takeaway","lines":[]}');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', 'aaaaaaaa-0000-0000-0000-000000000004', 'cash') $$, 'EMPTY_ORDER');
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000004","kind":"takeaway","lines":[{"name":"Masala chai","price":30,"qty":1,"gst_rate":5}]}');
select t.check((public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000004', 'cash'))->>'invoice_no' ~ '-0002$', 'second invoice');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', 'aaaaaaaa-0000-0000-0000-000000000004', 'bitcoin') $$, 'BAD_PAYMENT');

-- new walk-in number without consent: payment still goes through, points problem reported
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000005","kind":"takeaway","customer_mobile":"9000000009","lines":[{"name":"Masala chai","price":300,"qty":1,"gst_rate":5}]}');
select t.check((public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000005', 'cash'))->>'points_error' like '%CONSENT%', 'consent problem reported, bill paid');
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000006","kind":"takeaway","customer_mobile":"9000000010","lines":[{"name":"Masala chai","price":300,"qty":1,"gst_rate":5}]}');
select t.check(((public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000006', 'cash', 'A', true))->>'points_earned')::int = 6, 'with consent: points');
reset role;

-- points on a bill: approve, remove (points come back), approve again and pay, cancel gives back
select public.add_bill(:'shop', '7353862216', null, 5000, null, true);
select (public.customer_balance(:'shop', '7353862216'))->>'balance' as bal0 \gset
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000007","kind":"takeaway","customer_mobile":"7353862216","lines":[{"name":"Veg biryani","price":200,"qty":1,"gst_rate":5}]}');
select (public.biz_start_redemption(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007', 60))->>'request_id' as rq1 \gset
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', 'aaaaaaaa-0000-0000-0000-000000000007', 'cash') $$, 'REDEEM_PENDING');
reset role;
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select public.app_decide(:'rq1', true);
reset role;
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.check(((public.customer_balance(:'shop', '7353862216'))->>'balance')::int = :bal0 - 60, 'approved: 60 taken');
select t.check((public.biz_preview(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007'))->>'total' = '140', 'discount on bill');
select public.biz_use_redemption(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007', null);
select t.check(((public.customer_balance(:'shop', '7353862216'))->>'balance')::int = :bal0, 'removed: points back');
select t.check((public.biz_preview(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007'))->>'total' = '200', 'discount gone');
-- approve again, then pay with the discount
select (public.biz_start_redemption(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007', 50))->>'request_id' as rq2 \gset
reset role;
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select public.app_decide(:'rq2', true);
reset role;
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.check((public.biz_pay_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000007', 'upi'))->'totals'->>'total' = '150', 'paid with points');
-- cancelling an order gives approved points back
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000008","kind":"takeaway","customer_mobile":"7353862216","lines":[{"name":"Veg biryani","price":200,"qty":1,"gst_rate":5}]}');
select (public.customer_balance(:'shop', '7353862216'))->>'balance' as bal1 \gset
select (public.biz_start_redemption(:'shop', 'aaaaaaaa-0000-0000-0000-000000000008', 50))->>'request_id' as rq3 \gset
reset role;
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select public.app_decide(:'rq3', true);
reset role;
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.biz_cancel_order(:'shop', 'aaaaaaaa-0000-0000-0000-000000000008');
select t.check(((public.customer_balance(:'shop', '7353862216'))->>'balance')::int = :bal1, 'cancel: points back');
-- changing the customer drops a waiting request
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000009","kind":"takeaway","customer_mobile":"7353862216","lines":[{"name":"Veg biryani","price":200,"qty":1,"gst_rate":5}]}');
select (public.biz_start_redemption(:'shop', 'aaaaaaaa-0000-0000-0000-000000000009', 50))->>'request_id' as rq4 \gset
select public.biz_save_order(:'shop', '{"id":"aaaaaaaa-0000-0000-0000-000000000009","kind":"takeaway","customer_mobile":"9000000010","lines":[{"name":"Veg biryani","price":200,"qty":1,"gst_rate":5}]}');
select t.check((public.biz_invoice(:'shop', 'aaaaaaaa-0000-0000-0000-000000000009'))->>'redeem_request_id' is null, 'new customer: request dropped');
reset role;

-- other shops see nothing
select t.as_user('33333333-3333-3333-3333-333333333333');
set role authenticated;
select t.expect_error($$ select public.biz_invoice('$$ || :'shop' || $$', 'aaaaaaaa-0000-0000-0000-000000000001') $$, 'NOT_A_MEMBER');
select (public.create_shop('Other Cafe')).id as other \gset
select t.expect_error($$ select public.biz_save_order('$$ || :'other' || $$', '{"id":"aaaaaaaa-0000-0000-0000-000000000001","lines":[]}') $$, 'NOT_FOUND');
reset role;
select 'ALL TESTS PASSED' as result;
