-- Khushi Biz step 4: stock and reports. Fresh database with shim + migrations.
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
  ('22222222-2222-2222-2222-222222222222', 'cashier@cafe.in');
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Chai Adda')).id as shop \gset
select join_code as code from public.shops where id = :'shop' \gset
select public.biz_save_item(:'shop', '{"name":"Coke","price":40,"gst_rate":18}') as coke \gset
select public.biz_save_item(:'shop', '{"name":"Chai","price":30,"gst_rate":5}') as chai \gset
-- count stock for Coke only; 24 bottles in
select public.biz_stock_track(:'shop', :'coke', true);
select public.biz_stock_count(:'shop', :'coke', 24);
select t.check(((select i from jsonb_array_elements((public.biz_menu(:'shop'))->'items') i where i->>'name' = 'Coke')->>'stock')::numeric = 24, 'menu shows 24');
select public.biz_stock_low(:'shop', :'coke', 30);
select t.check(((select i from jsonb_array_elements((public.biz_stock(:'shop'))->'items') i where i->>'name' = 'Coke')->>'low_stock')::numeric = 30, 'low level set');
reset role;

-- cashier adds a delivery; cannot change tracking or stocktake
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.check(public.biz_stock_add(:'shop', :'coke', 6) = 30, 'delivery: 30');
select t.expect_error($$ select public.biz_stock_add('$$ || :'shop' || $$', '$$ || :'chai' || $$', 5) $$, 'NOT_FOUND');
select t.expect_error($$ select public.biz_stock_count('$$ || :'shop' || $$', '$$ || :'coke' || $$', 1) $$, 'OWNER_ONLY');
select t.expect_error($$ select public.biz_stock_add('$$ || :'shop' || $$', '$$ || :'coke' || $$', 0) $$, 'BAD_QTY');
-- sell 3 Coke + 2 Chai; only Coke goes down
select public.biz_save_order(:'shop', jsonb_build_object('id','dddddddd-0000-0000-0000-000000000001','kind','takeaway','lines',
  jsonb_build_array(jsonb_build_object('item_id',:'coke','name','Coke','price',40,'qty',3,'gst_rate',18),
                    jsonb_build_object('item_id',:'chai','name','Chai','price',30,'qty',2,'gst_rate',5))));
select public.biz_pay_order(:'shop', 'dddddddd-0000-0000-0000-000000000001', 'upi');
select t.check(((select i from jsonb_array_elements((public.biz_stock(:'shop'))->'items') i where i->>'name' = 'Coke')->>'stock')::numeric = 27, 'sold 3: 27 left');
select t.check(((select i from jsonb_array_elements((public.biz_stock(:'shop'))->'items') i where i->>'name' = 'Chai')->>'stock')::numeric = 0, 'chai not counted');
-- paying again does not take stock twice
select public.biz_pay_order(:'shop', 'dddddddd-0000-0000-0000-000000000001', 'upi');
select t.check(((select i from jsonb_array_elements((public.biz_stock(:'shop'))->'items') i where i->>'name' = 'Coke')->>'stock')::numeric = 27, 'still 27');
select t.check(jsonb_array_length((public.biz_stock(:'shop'))->'moves') = 3, 'log: count, add, sale');
select t.expect_error($$ select public.biz_report('$$ || :'shop' || $$', current_date, current_date) $$, 'OWNER_ONLY');
-- second bill, cash
select public.biz_save_order(:'shop', '{"id":"dddddddd-0000-0000-0000-000000000002","kind":"takeaway","lines":[{"name":"Chai","price":30,"qty":1,"gst_rate":5}]}');
select public.biz_pay_order(:'shop', 'dddddddd-0000-0000-0000-000000000002', 'cash');
reset role;

-- owner report for today: 2 bills, 180 + 30 = 210
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.biz_report(:'shop', current_date - 1, current_date + 1) as r \gset
select t.check((:'r'::jsonb)->>'bills' = '2', '2 bills');
select t.check((:'r'::jsonb)->>'sales' = '210', 'sales 210');
select t.check(jsonb_array_length((:'r'::jsonb)->'by_mode') = 2, 'upi and cash');
select t.check(((:'r'::jsonb)->'items'->0->>'name') = 'Coke', 'top item by amount');
select t.check(((select x from jsonb_array_elements((:'r'::jsonb)->'items') x where x->>'name' = 'Chai')->>'qty')::numeric = 3, 'chai qty 3');
select t.check(jsonb_array_length((:'r'::jsonb)->'by_rate') = 2, 'two gst rates');
select t.check(jsonb_array_length((:'r'::jsonb)->'invoices') = 2, 'invoice list');
select t.check((:'r'::jsonb)->>'taxable' <> '0', 'taxable');
select t.check((public.biz_report(:'shop', current_date - 30, current_date - 20))->>'bills' = '0', 'other dates empty');
select t.expect_error($$ select public.biz_report('$$ || :'shop' || $$', current_date, current_date - 1) $$, 'BAD_RANGE');
reset role;
-- bill history and void
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check(jsonb_array_length(public.biz_bills(:'shop', current_date - 1, current_date + 1)) = 2, 'two bills in history');
select t.check(jsonb_array_length(public.biz_bills(:'shop', current_date - 1, current_date + 1, 'nomatch')) = 0, 'search');
select public.biz_void_order(:'shop', 'dddddddd-0000-0000-0000-000000000001', 'Wrong table');
select t.check((public.biz_invoice(:'shop', 'dddddddd-0000-0000-0000-000000000001'))->>'status' = 'void', 'voided');
select t.check((public.biz_invoice(:'shop', 'dddddddd-0000-0000-0000-000000000001'))->>'void_reason' = 'Wrong table', 'reason kept');
select t.check(((select i from jsonb_array_elements((public.biz_stock(:'shop'))->'items') i where i->>'name' = 'Coke')->>'stock')::numeric = 30, 'stock back to 30');
select t.check((public.biz_report(:'shop', current_date - 1, current_date + 1))->>'sales' = '30', 'void left out of reports');
select t.check(jsonb_array_length(public.biz_bills(:'shop', current_date - 1, current_date + 1)) = 2, 'void still listed');
select t.expect_error($$ select public.biz_void_order('$$ || :'shop' || $$', 'dddddddd-0000-0000-0000-999999999999') $$, 'NOT_FOUND');
reset role;
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.expect_error($$ select public.biz_void_order('$$ || :'shop' || $$', 'dddddddd-0000-0000-0000-000000000002') $$, 'OWNER_ONLY');
reset role;
select 'ALL TESTS PASSED' as result;
