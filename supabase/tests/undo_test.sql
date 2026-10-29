-- Undo tests. Run on a fresh database with supabase_shim.sql + migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.in'),
  ('22222222-2222-2222-2222-222222222222', 'cashier@shop.in'),
  ('44444444-4444-4444-4444-444444444444', 'cashier2@shop.in');
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

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Sahasra Clothing')).id as shop \gset
select join_code as code from public.shops where id = :'shop' \gset
select t.as_user('22222222-2222-2222-2222-222222222222');
select public.join_shop(:'code');
select t.as_user('44444444-4444-4444-4444-444444444444');
select public.join_shop(:'code');

-- cashier types 50000 instead of 5000, undoes it, enters the right amount with the same bill number
select t.as_user('22222222-2222-2222-2222-222222222222');
select (public.add_bill(:'shop', '7353862216', 'B-1001', 50000, 'Kiran', true))->>'txn_id' as typo \gset
select t.check((public.customer_balance(:'shop', '7353862216'))->>'balance' = '1000', 'typo gave 1000');
-- another cashier cannot undo it
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.expect_error($$ select public.reverse_transaction('$$ || :'shop' || $$', $$ || :'typo' || $$) $$, 'UNDO_OWNER_ONLY');
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.check((public.reverse_transaction(:'shop', :'typo'))->>'balance' = '0', 'own undo within 15 min');
select t.expect_error($$ select public.reverse_transaction('$$ || :'shop' || $$', $$ || :'typo' || $$) $$, 'ALREADY_UNDONE');
-- bill number is free again, and the undone bill does not block "highest bill today"
select t.check((public.add_bill(:'shop', '7353862216', 'B-1001', 5000, null, false))->>'points' = '100', 're-entered bill earns 100');

-- after 15 minutes only the owner can undo
reset role;
update public.transactions set created_at = created_at - interval '20 minutes';
set role authenticated;
select (select id from public.transactions where bill_no = 'B-1001' and reversed_at is null) as good \gset
select t.expect_error($$ select public.reverse_transaction('$$ || :'shop' || $$', $$ || :'good' || $$) $$, 'UNDO_OWNER_ONLY');

-- redeem 60, then undo the redemption: points come back
select t.as_user('22222222-2222-2222-2222-222222222222');
reset role; set role service_role;
select (public.create_otp(:'shop', '7353862216'))->>'code' as otp \gset
reset role; set role authenticated;
select (public.redeem_with_otp(:'shop', '7353862216', 500, 60, :'otp', '5829'))->>'txn_id' as red \gset
select t.check((public.customer_balance(:'shop', '7353862216'))->>'balance' = '40', 'after redeem 40');
select t.check((public.reverse_transaction(:'shop', :'red'))->>'balance' = '100', 'undo redeem gives 60 back');

-- spend 80, then the owner tries to undo the 100-point bill: not enough left
select t.check((public.redeem_with_pin(:'shop', '7353862216', 500, 80, '5829'))->>'balance' = '20', 'PIN redeem 80');
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.expect_error($$ select public.reverse_transaction('$$ || :'shop' || $$', $$ || :'good' || $$) $$, 'POINTS_ALREADY_USED');

-- reports skip undone entries
select t.check((public.shop_dashboard(:'shop'))->>'points_given' = '100', 'dashboard ignores undone bill');
select t.check((public.shop_dashboard(:'shop'))->>'points_redeemed' = '80', 'dashboard ignores undone redeem');
select t.check((select count(*) from public.recent_activity(:'shop', 50) where undone) = 2, 'activity marks 2 undone');
select t.check((select visits from public.list_customers(:'shop', null)) = 1, 'visits ignore undone');

-- owner undoes a later bill fully
reset role; update public.transactions set created_at = created_at - interval '1 day'; set role authenticated;
select (public.add_bill(:'shop', '7353862216', 'B-2000', 1000, null, false))->>'txn_id' as late \gset
select t.check((public.reverse_transaction(:'shop', :'late'))->>'balance' = '20', 'owner undo any time');
reset role;
select 'ALL TESTS PASSED' as result;
