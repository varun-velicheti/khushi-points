-- POS split payments and partial refunds (credit notes): validation, stock, reports, void after refund.
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
update public.shops set biz_enabled = true, gst_inclusive = true where id = :'shop';
set role authenticated;
select public.biz_save_item(:'shop', '{"name":"Masala chai","price":30,"gst_rate":5}'::jsonb) as chai \gset
select public.biz_save_item(:'shop', '{"name":"Veg biryani","price":180,"gst_rate":5}'::jsonb) as biry \gset
select public.biz_stock_track(:'shop', :'chai', true);
select public.biz_stock_add(:'shop', :'chai', 10);
select public.biz_claim_series(:'shop', 'Counter', 'A');
\set o1 'cccccccc-0000-0000-0000-000000000001'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o1', 'kind', 'takeaway', 'lines', jsonb_build_array(
  jsonb_build_object('item_id', :'chai', 'name', 'Masala chai', 'price', 30, 'qty', 4, 'gst_rate', 5),
  jsonb_build_object('item_id', :'biry', 'name', 'Veg biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));

-- split payment must add up to the total (300) and be well formed
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'upi', 'A', false, null, null, '[{"mode":"upi","amount":100},{"mode":"cash","amount":199}]') $$, 'PAYMENTS_MISMATCH');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'upi', 'A', false, null, null, '[{"mode":"gold","amount":300}]') $$, 'BAD_PAYMENT');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'upi', 'A', false, null, null, '[{"mode":"upi","amount":"300"}]') $$, 'BAD_PAYMENT');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'upi', 'A', false, null, null, '[{"mode":"upi","amount":0},{"mode":"cash","amount":300}]') $$, 'BAD_PAYMENT');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'upi', 'A', false, null, null, '[]') $$, 'BAD_PAYMENT');
-- refund before paying
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":1}]', 'cash') $$, 'NOT_PAID');
select public.biz_pay_order(:'shop', :'o1', 'upi', 'A', false, null, null, '[{"mode":"upi","amount":100.5},{"mode":"cash","amount":199.5}]'::jsonb) as paid \gset
select t.check((:'paid'::jsonb)->>'status' = 'paid' and jsonb_array_length((:'paid'::jsonb)->'payments') = 2, 'paid in two parts');
select t.check((:'paid'::jsonb)->'payments'->1->>'mode' = 'cash' and ((:'paid'::jsonb)->'payments'->1->>'amount')::numeric = 199.5, 'parts kept');
-- paying again (a retry) changes nothing
select t.check(jsonb_array_length((public.biz_pay_order(:'shop', :'o1', 'cash'))->'payments') = 2, 'retry keeps the split');
-- plain payment still works as before
\set o2 'cccccccc-0000-0000-0000-000000000002'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o2', 'kind', 'takeaway', 'lines', jsonb_build_array(
  jsonb_build_object('item_id', :'biry', 'name', 'Veg biryani', 'price', 180, 'qty', 1, 'gst_rate', 5))));
select t.check(((public.biz_pay_order(:'shop', :'o2', 'card'))->'payments'->0->>'amount')::numeric = 180, 'single payment');

select t.check(b->>'mode' = 'split', 'bills list says split') from jsonb_array_elements(public.biz_bills(:'shop', current_date - 1, current_date + 1)) b where b->>'id' = :'o1';
select public.biz_report(:'shop', current_date - 1, current_date + 1) as r1 \gset
select t.check(((:'r1'::jsonb)->>'sales')::numeric = 480, 'sales before refunds');
select t.check((select (m->>'amount')::numeric from jsonb_array_elements((:'r1'::jsonb)->'by_mode') m where m->>'mode' = 'cash') = 199.5, 'cash part counted under cash');
select t.check((select (m->>'amount')::numeric from jsonb_array_elements((:'r1'::jsonb)->'by_mode') m where m->>'mode' = 'upi') = 100.5, 'upi part counted under upi');

-- refund 1 chai: credit note -R1, ₹30, stock back
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash', 'spilled') as inv \gset
select t.check(jsonb_array_length((:'inv'::jsonb)->'refunds') = 1, 'one credit note');
select t.check((:'inv'::jsonb)->'refunds'->0->>'credit_no' = ((:'inv'::jsonb)->>'invoice_no') || '-R1', 'credit note number');
select t.check(((:'inv'::jsonb)->'refunds'->0->'totals'->>'total')::numeric = 30, 'refund amount');
select t.check((:'inv'::jsonb)->'refunds'->0->>'reason' = 'spilled', 'reason kept');
select t.check((select stock from public.menu_items where id = :'chai') = 7, 'stock 10 - 4 + 1');
-- the same refund again (retry) does nothing
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash');
reset role;
select t.check((select count(*) from public.biz_refunds where order_id = :'o1') = 1, 'retry does not refund twice');
set role authenticated;
-- more than was bought
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":4}]', 'cash') $$, 'REFUND_TOO_MUCH');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":2},{"i":0,"qty":2}]', 'cash') $$, 'REFUND_TOO_MUCH');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":5,"qty":1}]', 'cash') $$, 'BAD_LINES');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":0}]', 'cash') $$, 'BAD_LINES');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":1}]', 'gold') $$, 'BAD_PAYMENT');
-- the other 3 chai, by UPI -> -R2
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000002', '[{"i":0,"qty":3}]', 'upi') as inv2 \gset
select t.check((:'inv2'::jsonb)->'refunds'->1->>'credit_no' like '%-R2' and ((:'inv2'::jsonb)->'refunds'->1->'totals'->>'total')::numeric = 90, 'second credit note');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":1}]', 'cash') $$, 'REFUND_TOO_MUCH');

select t.check((b->>'refunded')::numeric = 120, 'bills list shows refunded') from jsonb_array_elements(public.biz_bills(:'shop', current_date - 1, current_date + 1)) b where b->>'id' = :'o1';
select public.biz_report(:'shop', current_date - 1, current_date + 1) as r2 \gset
select t.check(((:'r2'::jsonb)->>'sales')::numeric = 360, 'sales less refunds');
select t.check(((:'r2'::jsonb)->'refunds'->>'count')::int = 2 and ((:'r2'::jsonb)->'refunds'->>'amount')::numeric = 120, 'refunds summary');
select t.check((select (m->>'amount')::numeric from jsonb_array_elements((:'r2'::jsonb)->'by_mode') m where m->>'mode' = 'cash') = 169.5, 'cash less cash refund');
select t.check((select (i->>'qty')::numeric from jsonb_array_elements((:'r2'::jsonb)->'items') i where i->>'name' = 'Masala chai') = 0, 'chai sold net 0');
select t.check(jsonb_array_length((:'r2'::jsonb)->'credit_notes') = 2, 'credit notes listed');
select t.check(((:'r2'::jsonb)->>'gst')::numeric = (select sum((x->>'cgst')::numeric + (x->>'sgst')::numeric) from jsonb_array_elements((:'r2'::jsonb)->'by_rate') x), 'GST summary matches');

-- voiding after the refunds returns no more chai (all 4 already back)
select public.biz_void_order(:'shop', :'o1', 'test');
select t.check((select stock from public.menu_items where id = :'chai') = 10, 'no double stock return');
select t.check(((public.biz_report(:'shop', current_date - 1, current_date + 1))->>'sales')::numeric = 180, 'void bill and its refunds leave reports');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":1,"qty":1}]', 'cash') $$, 'NOT_PAID');
reset role;
select 'ALL TESTS PASSED' as result;
