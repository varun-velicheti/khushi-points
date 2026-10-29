-- External (Verify Now) OTP path. Run on a fresh database with shim + migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'owner@shop.in'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@shop.in');
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
select public.add_bill(:'shop', '7353862216', 'B-1', 10000, 'Kiran', true);   -- 200 pts
-- staff cannot call the external functions directly
select t.expect_error($$ select public.create_external_otp('$$ || :'shop' || $$', '7353862216') $$, 'permission denied');
select t.expect_error($$ select public.redeem_with_external_otp('$$ || :'shop' || $$', '7353862216', 500, 60, null, '11111111-1111-1111-1111-111111111111', 1, true) $$, 'permission denied');
reset role;

-- what send-otp does with Verify Now
set role service_role;
select (public.create_external_otp(:'shop', '7353862216'))->>'otp_id' as oid \gset
-- before the provider reference is saved, nothing is pending
select t.check((public.pending_external_otp(:'shop', '7353862216'))->>'error' = 'OTP_EXPIRED', 'no ref yet');
select public.set_otp_ref(:'oid', 'VN-123');
select t.check((public.pending_external_otp(:'shop', '7353862216'))->>'ref' = 'VN-123', 'pending has ref');
select t.expect_error($$ select public.pending_external_otp('$$ || :'shop' || $$', '7353862216', '1234') $$, 'PIN_TOO_EASY');
reset role;

-- our own OTP check must not accept the external entry with any code
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.redeem_with_otp(:'shop', '7353862216', 500, 60, '000000', null))->>'error' = 'OTP_EXPIRED', 'own check ignores external OTP');
reset role;

set role service_role;
-- outsider as staff is refused
select t.expect_error($$ select public.redeem_with_external_otp('$$ || :'shop' || $$', '7353862216', 500, 60, null, '33333333-3333-3333-3333-333333333333', $$ || :'oid' || $$, true) $$, 'NOT_A_MEMBER');
-- provider says wrong code twice, then right
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 60, '5829', '11111111-1111-1111-1111-111111111111', :'oid', false))->>'tries_left' = '2', 'wrong 1');
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 60, '5829', '11111111-1111-1111-1111-111111111111', :'oid', false))->>'tries_left' = '1', 'wrong 2');
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 60, '5829', '11111111-1111-1111-1111-111111111111', :'oid', true))->>'balance' = '140', 'right code redeems 60');
-- code used once only
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 60, null, '11111111-1111-1111-1111-111111111111', :'oid', true))->>'error' = 'OTP_EXPIRED', 'single use');
select t.check((select staff_id from public.transactions where kind = 'redeem') = '11111111-1111-1111-1111-111111111111', 'staff recorded');
reset role;

-- PIN set by the external path works for the PIN redeem
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.redeem_with_pin(:'shop', '7353862216', 500, 50, '5829'))->>'balance' = '90', 'PIN from external OTP works');
reset role;

-- three wrong codes burn the OTP; an expired answer ends it too
set role service_role;
select (public.create_external_otp(:'shop', '7353862216'))->>'otp_id' as o2 \gset
select public.set_otp_ref(:'o2', 'VN-2');
select public.redeem_with_external_otp(:'shop', '7353862216', 500, 50, null, '11111111-1111-1111-1111-111111111111', :'o2', false);
select public.redeem_with_external_otp(:'shop', '7353862216', 500, 50, null, '11111111-1111-1111-1111-111111111111', :'o2', false);
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 50, null, '11111111-1111-1111-1111-111111111111', :'o2', false))->>'error' = 'OTP_TOO_MANY_TRIES', 'third wrong burns it');
select (public.create_external_otp(:'shop', '7353862216'))->>'otp_id' as o3 \gset
select public.set_otp_ref(:'o3', 'VN-3');
select t.check((public.redeem_with_external_otp(:'shop', '7353862216', 500, 50, null, '11111111-1111-1111-1111-111111111111', :'o3', false, true))->>'error' = 'OTP_EXPIRED', 'expired answer');
select t.expect_error($$ select public.create_external_otp('$$ || :'shop' || $$', '7353862216') $$, 'OTP_RATE_LIMIT');
reset role;
select 'ALL TESTS PASSED' as result;
