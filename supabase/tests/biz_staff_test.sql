-- POS staff PINs, manager approvals and cash shifts.
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
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'owner@cafe.in'), ('22222222-2222-2222-2222-222222222222', 'counter@cafe.in');
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Chai Adda')).id as shop \gset
reset role;
update public.shops set biz_enabled = true, gst_inclusive = true where id = :'shop';
set role authenticated;
select join_code as code from public.shops where id = :'shop' \gset
select public.biz_save_item(:'shop', '{"name":"Chai","price":30,"gst_rate":5}'::jsonb) as chai \gset
select public.biz_claim_series(:'shop', 'Counter', 'A');

-- owner adds staff
select public.biz_staff_save(:'shop', '{"name":"Ravi","role":"cashier","pin":"1234"}') as ravi \gset
select public.biz_staff_save(:'shop', '{"name":"Meena","role":"manager","pin":"9876"}') as meena \gset
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"X","role":"cashier","pin":"1234"}') $$, 'PIN_TAKEN');
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"X","role":"cashier","pin":"12"}') $$, 'BAD_PIN');
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"X","role":"cashier"}') $$, 'BAD_PIN');
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"X","role":"boss","pin":"5555"}') $$, 'BAD_ROLE');
select t.check(jsonb_array_length(public.biz_staff_list(:'shop')) = 2, 'two staff');
select t.check(jsonb_array_length((public.biz_menu(:'shop'))->'staff') = 2 and not ((public.biz_menu(:'shop'))->'staff'->0 ? 'pin_hash'), 'menu lists staff without PINs');
-- editing keeps the PIN when none is given; same PIN for the same person is fine
select public.biz_staff_save(:'shop', jsonb_build_object('id', :'ravi', 'name', 'Ravi K', 'role', 'cashier'));
select public.biz_staff_save(:'shop', jsonb_build_object('id', :'ravi', 'name', 'Ravi K', 'role', 'cashier', 'pin', '1234'));
reset role;

-- the counter device is signed in as a cashier account
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"Y","role":"manager","pin":"4444"}') $$, 'OWNER_ONLY');
select t.check((public.biz_staff_check(:'shop', '1234'))->>'name' = 'Ravi K', 'Ravi by PIN');
select t.check((public.biz_staff_check(:'shop', '1234'))->>'approval' is null, 'cashier gets no approval');
select t.check((public.biz_staff_check(:'shop', '0000'))->>'error' = 'WRONG_PIN', 'wrong PIN');

-- Ravi takes an order; the bill remembers him
\set o1 'cccccccc-0000-0000-0000-000000000001'
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o1', 'kind', 'takeaway', 'staff_id', :'ravi', 'lines',
  jsonb_build_array(jsonb_build_object('item_id', :'chai', 'name', 'Chai', 'price', 30, 'qty', 2, 'gst_rate', 5))));
-- a later save by someone else keeps the first person
select public.biz_save_order(:'shop', jsonb_build_object('id', :'o1', 'kind', 'takeaway', 'staff_id', :'meena', 'lines',
  jsonb_build_array(jsonb_build_object('item_id', :'chai', 'name', 'Chai', 'price', 30, 'qty', 3, 'gst_rate', 5))));
-- cash shift: open with ₹500
\set sh 'eeeeeeee-0000-0000-0000-000000000001'
select public.biz_shift_open(:'shop', :'sh', 500, :'ravi');
select public.biz_shift_open(:'shop', :'sh', 500, :'ravi');
select t.expect_error($$ select public.biz_shift_open('$$ || :'shop' || $$', gen_random_uuid(), 100) $$, 'SHIFT_OPEN');
select public.biz_pay_order(:'shop', :'o1', 'cash', 'A', false, null, null, '[{"mode":"cash","amount":50},{"mode":"upi","amount":40}]'::jsonb);
select t.check((public.biz_invoice(:'shop', :'o1'))->>'staff' = 'Ravi K', 'bill remembers Ravi');

-- cashier account cannot void, refund or see reports without a manager
select t.expect_error($$ select public.biz_report('$$ || :'shop' || $$', current_date, current_date) $$, 'MANAGER_ONLY');
select t.expect_error($$ select public.biz_refund_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', gen_random_uuid(), '[{"i":0,"qty":1}]', 'cash') $$, 'MANAGER_ONLY');
select t.expect_error($$ select public.biz_void_order('$$ || :'shop' || $$', '$$ || :'o1' || $$', 'x', gen_random_uuid()) $$, 'MANAGER_ONLY');
-- a cashier PIN gives nothing; the manager's PIN gives an approval
select (public.biz_staff_check(:'shop', '9876'))->>'approval' as ok \gset
select t.check((public.biz_report(:'shop', current_date, current_date, :'ok'))->'by_staff'->0->>'name' = 'Ravi K', 'report with approval, sales by staff');
select public.biz_refund_order(:'shop', :'o1', 'dddddddd-0000-0000-0000-000000000001', '[{"i":0,"qty":1}]', 'cash', 'spilt', :'ok');
-- the approval is only good for this call's own work: other owner-only things still refuse
select t.expect_error($$ select public.biz_staff_save('$$ || :'shop' || $$', '{"name":"Z","role":"manager","pin":"4321"}') $$, 'OWNER_ONLY');

-- shift: expected = 500 float + 50 cash part - 30 cash refund = 520; counted 515
select t.check(((public.biz_shifts(:'shop'))->'open'->>'expected')::numeric = 520, 'expected cash');
select t.check(((public.biz_shifts(:'shop'))->'open'->>'opened_by') = 'Ravi K', 'opened by Ravi');
select public.biz_shift_close(:'shop', :'sh', 515, :'meena', 'short 5') as closed \gset
select t.check(((:'closed'::jsonb)->'recent'->0->>'difference')::numeric = -5, 'short by 5');
select t.check((:'closed'::jsonb)->'open' = 'null'::jsonb, 'no open shift');
-- closing again changes nothing
select public.biz_shift_close(:'shop', :'sh', 999);
select t.check(((public.biz_shifts(:'shop'))->'recent'->0->>'counted')::numeric = 515, 'close is final');

-- too many wrong PINs locks PIN entry
select public.biz_staff_check(:'shop', '0000') from generate_series(1, 8);
select t.check((public.biz_staff_check(:'shop', '9876'))->>'error' = 'TOO_MANY_TRIES', 'locked after wrong PINs');
reset role;
-- expired approvals do nothing
update public.biz_approvals set expires_at = now() - interval '1 minute';
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.expect_error($$ select public.biz_report('$$ || :'shop' || $$', current_date, current_date, '$$ || :'ok' || $$') $$, 'MANAGER_ONLY');
reset role;

-- owner's own login still works without a PIN; removed staff are gone
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.biz_report(:'shop', current_date, current_date)) ? 'by_staff', 'owner sees reports');
select public.biz_staff_remove(:'shop', :'meena');
select t.check(jsonb_array_length(public.biz_staff_list(:'shop')) = 1, 'manager removed');
reset role;
select 'ALL TESTS PASSED' as result;
