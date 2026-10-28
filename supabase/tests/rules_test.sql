-- Rules test. Run on a database that has supabase_shim.sql + the migrations.
-- Every check raises an error on failure, so a clean run ends with "ALL TESTS PASSED".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema t;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.in'),
  ('22222222-2222-2222-2222-222222222222', 'cashier@shop.in'),
  ('33333333-3333-3333-3333-333333333333', 'other@shop.in');

create or replace function t.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); end $$;

-- runs sql as the current role and checks it fails with the expected error code
create or replace function t.expect_error(q text, code text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected % but statement succeeded: %', code, q;
exception when others then
  if sqlerrm not like '%' || code || '%' then raise exception 'expected %, got %  (%)', code, sqlerrm, q; end if;
end $$;
create or replace function t.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'CHECK FAILED: %', msg; end if; end $$;

grant execute on all functions in schema t to public;
grant usage on schema t to public;

-- ---------------------------------------------------------------- shop setup
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Sri Lakshmi Stores')).id as shop \gset
select join_code as code, slug from public.shops where id = :'shop' \gset
select t.check(:'slug' like 'sri-lakshmi-stores-%', 'slug made from name');

-- cashier joins with the code
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.check((public.join_shop(lower(:'code'))).id = :'shop', 'cashier joins with code (any case)');
select t.expect_error($$ select public.update_shop_settings('$$ || :'shop' || $$', '{"earn_pct":10}') $$, 'OWNER_ONLY');
select t.expect_error($$ select public.shop_dashboard('$$ || :'shop' || $$') $$, 'OWNER_ONLY');

-- outsider sees nothing and can do nothing
select t.as_user('33333333-3333-3333-3333-333333333333');
select t.check((select count(*) from public.shops) = 0, 'outsider cannot read shop');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9848012345', 'B1', 500, null, true) $$, 'NOT_A_MEMBER');
select t.expect_error($$ select public.join_shop('WRONG1') $$, 'BAD_JOIN_CODE');

-- ---------------------------------------------------------------- earning
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '12345', 'B1', 500, null, true) $$, 'BAD_MOBILE');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9848012345', 'B1', 500, null, false) $$, 'CONSENT_REQUIRED');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9848012345', 'B1', 50, null, true) $$, 'BELOW_MIN_BILL');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9848012345', '', 500, null, true) $$, 'BILL_NO_REQUIRED');

-- 2% of 1250 = 25 points; +91 prefix and spaces are accepted
select t.check((public.add_bill(:'shop', '+91 98480 12345', 'b-1001', 1250, 'Ravi', true))->>'points' = '25', '2% of 1250 = 25 pts');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9701122334', 'B-1001', 900, null, true) $$, 'BILL_ALREADY_USED');
select t.expect_error($$ select public.add_bill('$$ || :'shop' || $$', '9848012345', 'B-1002', 900, null, true) $$, 'ALREADY_EARNED_TODAY');

-- move that bill to yesterday, then a new bill today earns
reset role;
update public.transactions set created_at = now() - interval '1 day';
set role authenticated;
select t.check((public.add_bill(:'shop', '9848012345', 'B-1002', 5000, null, false))->>'balance' = '125', 'second day: 25 + 100 = 125');

-- ---------------------------------------------------------------- balance
select t.check((public.customer_balance(:'shop', '9848012345'))->>'balance' = '125', 'balance 125');
select t.check((public.customer_balance(:'shop', '9848012345'))->>'has_pin' = 'false', 'no PIN yet');
select t.check((public.customer_balance(:'shop', '9000000000'))->>'exists' = 'false', 'unknown number');
-- staff cannot read PIN hashes or OTP table directly
select t.expect_error('select pin_hash from public.customers', 'permission denied');
select t.check((select count(*) from public.otp_codes) = 0, 'otp table hidden');
-- staff cannot write tables directly
select t.expect_error($$ update public.point_lots set points_left = 9999 $$, '');
select t.check((public.customer_balance(:'shop', '9848012345'))->>'balance' = '125', 'direct update had no effect');
-- staff cannot create OTPs themselves (would let them see the code)
select t.expect_error($$ select public.create_otp('$$ || :'shop' || $$', '9848012345') $$, 'permission denied');

-- public page
reset role; set role anon; select t.as_user(null);
select t.check((public.public_balance(:'slug', '98480 12345'))->>'points' = '125', 'public balance');
select t.check((public.public_balance(:'slug', '98480 12345'))->>'name' is null, 'public page hides name');
select t.expect_error($$ select public.customer_balance('$$ || :'shop' || $$', '9848012345') $$, 'permission denied');
reset role;

-- ---------------------------------------------------------------- redeem with OTP (first time)
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.expect_error($$ select public.redeem_with_pin('$$ || :'shop' || $$', '9848012345', 500, 60, '1234') $$, 'NO_PIN');
reset role;
-- what the send-otp server function does (service role)
set role service_role;
select (public.create_otp(:'shop', '9848012345'))->>'code' as otp \gset
reset role;
set role authenticated;
select t.expect_error($$ select public.redeem_with_otp('$$ || :'shop' || $$', '9848012345', 500, 60, '$$ || :'otp' || $$', '1234') $$, 'PIN_TOO_EASY');
select t.expect_error($$ select public.redeem_with_otp('$$ || :'shop' || $$', '9848012345', 500, 30, '$$ || :'otp' || $$', '7391') $$, 'BELOW_MIN_REDEEM');
select t.expect_error($$ select public.redeem_with_otp('$$ || :'shop' || $$', '9848012345', 100, 60, '$$ || :'otp' || $$', '7391') $$, 'OVER_MAX_DISCOUNT');
select t.check((public.redeem_with_otp(:'shop', '9848012345', 500, 60, '000000', '7391'))->>'error' in ('WRONG_OTP'), 'wrong OTP rejected');
select t.check((public.redeem_with_otp(:'shop', '9848012345', 500, 60, :'otp', '7391'))->>'balance' = '65', 'OTP redeem: 125 - 60 = 65');
-- an OTP works only once
select t.check((public.redeem_with_otp(:'shop', '9848012345', 500, 60, :'otp', null))->>'error' = 'OTP_EXPIRED', 'OTP single use');

-- ---------------------------------------------------------------- redeem with PIN
-- oldest points used first: the 25-pt lot is gone, 65 of the 100-pt lot remain
select t.check((select string_agg(points_left::text, ',' order by id) from public.point_lots) = '0,65', 'FIFO deduction');
select t.check((public.redeem_with_pin(:'shop', '9848012345', 500, 50, '1111'))->>'error' = 'WRONG_PIN', 'wrong PIN 1');
select t.check((public.redeem_with_pin(:'shop', '9848012345', 500, 50, '2222'))->>'tries_left' = '1', 'wrong PIN 2, 1 try left');
select t.check((public.redeem_with_pin(:'shop', '9848012345', 500, 50, '3333'))->>'error' = 'PIN_LOCKED', 'third wrong PIN locks');
select t.check((public.redeem_with_pin(:'shop', '9848012345', 500, 50, '7391'))->>'error' = 'PIN_LOCKED', 'locked even with right PIN');
reset role; set role service_role;
select (public.create_otp(:'shop', '9848012345'))->>'code' as otp2 \gset
reset role; set role authenticated;
select t.check((public.redeem_with_otp(:'shop', '9848012345', 500, 50, :'otp2', '5829'))->>'pin_set' = 'true', 'OTP unlocks and sets new PIN');
select t.check((public.customer_balance(:'shop', '9848012345'))->>'balance' = '15', 'balance 15');
select t.expect_error($$ select public.redeem_with_pin('$$ || :'shop' || $$', '9848012345', 5000, 50, '5829') $$, 'NOT_ENOUGH_POINTS');

-- earn then redeem with the new PIN
reset role; update public.transactions set created_at = created_at - interval '1 day'; set role authenticated;
select public.add_bill(:'shop', '9848012345', 'B-1003', 3000, null, false);  -- +60 = 75
select t.check((public.redeem_with_pin(:'shop', '9848012345', 400, 60, '5829'))->>'pay' = '340.00', 'PIN redeem: 400 - 60 = 340');

-- ---------------------------------------------------------------- expiry
reset role;
update public.point_lots set expires_at = now() - interval '1 minute';
set role authenticated;
select t.check((public.customer_balance(:'shop', '9848012345'))->>'balance' = '0', 'expired points not counted');

-- ---------------------------------------------------------------- OTP rate limit
reset role; set role service_role;
select public.create_otp(:'shop', '9848012345');
select t.expect_error($$ select public.create_otp('$$ || :'shop' || $$', '9848012345') $$, 'OTP_RATE_LIMIT');
reset role;

-- ---------------------------------------------------------------- owner tools
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.shop_dashboard(:'shop'))->>'redeems_pin' = '1', 'dashboard counts PIN redeems');
select t.check((select count(*) from public.list_staff(:'shop')) = 2, 'two staff');
select t.check((public.update_shop_settings(:'shop', '{"earn_pct": 5, "min_redeem": 20}')).earn_pct = 5, 'settings saved');
select t.expect_error($$ select public.update_shop_settings('$$ || :'shop' || $$', '{"max_redeem_pct": 150}') $$, 'check constraint');
select public.remove_staff(:'shop', '22222222-2222-2222-2222-222222222222');
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.expect_error($$ select public.customer_balance('$$ || :'shop' || $$', '9848012345') $$, 'NOT_A_MEMBER');
select t.as_user('11111111-1111-1111-1111-111111111111');
select public.delete_customer(:'shop', '9848012345');
select t.check((public.customer_balance(:'shop', '9848012345'))->>'exists' = 'false', 'customer deleted on request');
reset role;

select 'ALL TESTS PASSED' as result;
