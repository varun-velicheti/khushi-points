-- Customer app tests. Run on a fresh database with shim + migrations.
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
  ('11111111-1111-1111-1111-111111111111', 'biryani@shop.in'),
  ('22222222-2222-2222-2222-222222222222', 'icecream@shop.in'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'priya@gmail.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'p917353862216@phone.khushipoints.app');

-- two shops
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select public.update_shop_settings(:'bir', '{"category":"restaurant","area":"Madhapur","city":"Hyderabad","hours":"11am - 11pm"}');
select t.as_user('22222222-2222-2222-2222-222222222222');
select (public.create_shop('Cream Stone')).id as ice \gset

-- before the customer has the app: ice-cream shop gives points to her number, bill number left empty
select t.check((public.add_bill(:'ice', '7353862216', null, 1000, 'Kiran', true))->>'points' = '20', 'no bill number needed');
select t.check((public.customer_balance(:'ice', '7353862216'))->>'has_app' = 'false', 'not on app yet');
-- redeeming needs the app
select t.expect_error($$ select public.start_redemption('$$ || :'ice' || $$', '7353862216', null, 500, 20) $$, 'NEEDS_APP');
reset role;

-- Priya signs in with Google: gets a member code, empty wallet
select t.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select (public.app_me())->>'member_code' as priya_code \gset
select t.check(:'priya_code' like 'K%' and length(:'priya_code') = 8, 'member code');
select t.check((select count(*) from public.app_wallet()) = 0, 'empty wallet');
select public.app_set_name('Priya');
reset role;

-- biryani cashier scans Priya's QR: no consent tick needed, she follows the shop, receipt saved
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.add_bill(:'bir', null, null, 2500, null, false, 'KP:' || :'priya_code', '2 Chicken Biryani, 1 Coke'))->>'points' = '50', 'earn by QR');
select t.expect_error($$ select public.add_bill('$$ || :'bir' || $$', null, null, 900, null, false, 'KZZZZZZZ') $$, 'BAD_MEMBER_CODE');
select t.check((public.customer_balance(:'bir', null, :'priya_code'))->>'balance' = '50', 'balance by QR');
reset role;

select t.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select t.check((select points from public.app_wallet() where name = 'Biryani House') = 50, 'wallet shows biryani points');
select t.check((select following from public.app_wallet() where name = 'Biryani House'), 'auto-follow');
select t.check((public.app_shop(:'bir'))->'history'->0->>'note' = '2 Chicken Biryani, 1 Coke', 'receipt in app');
select t.check((public.app_shop(:'bir'))->'shop'->>'area' = 'Madhapur', 'shop profile');
reset role;

-- Kiran signs in by phone (the server function attaches the verified number): ice-cream points appear
set role service_role;
select public.app_attach_phone('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '7353862216');
select t.expect_error($$ select public.app_attach_phone('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7353862216') $$, 'PHONE_IN_USE');
reset role;
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.check((public.app_me())->>'phone' = '7353862216', 'phone on profile');
select t.check((select points from public.app_wallet() where name = 'Cream Stone') = 20, 'old points now in app');
select t.check((select count(*) from public.app_wallet()) = 1, 'only own shops');
-- staff functions are not open to customers
select t.expect_error($$ select public.add_bill('$$ || :'ice' || $$', '7353862216', null, 5000) $$, 'NOT_A_MEMBER');
reset role;

-- later bills by number go straight into Kiran's app
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.add_bill(:'bir', '7353862216', 'B-9', 5000, null, true))->>'has_app' = 'true', 'number bill links to app');
reset role;
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.check((select count(*) from public.app_wallet()) = 2, 'kiran has 2 shops');
reset role;

-- offers: owner only, max 2 per 7 days, only followers see them, unfollow hides them
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.send_offer(:'bir', 'Weekend biryani: 10% off', 'Fri to Sun', current_date + 3))->>'followers' = '2', '2 followers');
select public.send_offer(:'bir', 'Free Coke on orders above 500');
select t.expect_error($$ select public.send_offer('$$ || :'bir' || $$', 'Third offer') $$, 'OFFER_LIMIT');
reset role;
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.expect_error($$ select public.send_offer('$$ || :'bir' || $$', 'Not my shop') $$, 'OWNER_ONLY');
reset role;
set role service_role;
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[priya]', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'android');
select t.check((select count(*) from public.push_targets_for_offer((select max(id) from public.offers))) = 1, 'push to follower token');
reset role;
select t.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select t.check((select count(*) from public.app_offers()) = 2, 'priya sees 2 offers');
select public.app_follow(:'bir', false);
select t.check((select count(*) from public.app_offers()) = 0, 'unfollow hides offers');
select public.app_follow(:'bir', true);
reset role;

-- approve-to-redeem: cashier starts, Priya approves in the app
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.expect_error($$ select public.start_redemption('$$ || :'bir' || $$', null, '$$ || :'priya_code' || $$', 500, 300) $$, 'NOT_ENOUGH_POINTS');
select (public.start_redemption(:'bir', null, :'priya_code', 500, 50))->>'request_id' as req \gset
select t.check((public.redemption_status(:'bir', :'req'))->>'status' = 'pending', 'pending');
reset role;
-- someone else cannot approve it
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.expect_error($$ select public.app_decide('$$ || :'req' || $$', true) $$, 'NO_REQUEST');
reset role;
select t.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select t.check((select points from public.app_pending()) = 50, 'priya sees request');
select t.check((public.app_decide(:'req', true))->>'balance' = '0', 'approved: 50 redeemed');
select t.check((public.app_decide(:'req', true))->>'error' = 'REQUEST_DONE', 'cannot approve twice');
reset role;
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.redemption_status(:'bir', :'req'))->>'status' = 'done', 'cashier sees done');
select t.check((public.redemption_status(:'bir', :'req'))->>'pay' = '450.00', 'customer pays 450');
select t.check((select method from public.transactions where kind = 'redeem') = 'app', 'method app');
select t.check((select staff_id from public.transactions where kind = 'redeem') = '11111111-1111-1111-1111-111111111111', 'cashier recorded');

-- decline and expiry
select (public.start_redemption(:'bir', '7353862216', null, 1000, 50))->>'request_id' as req2 \gset
reset role;
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.check((public.app_decide(:'req2', false))->>'status' = 'declined', 'declined');
reset role;
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.start_redemption(:'bir', '7353862216', null, 1000, 50))->>'request_id' as req3 \gset
reset role;
update public.redeem_requests set expires_at = now() - interval '1 second' where id = :'req3';
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.check((public.app_decide(:'req3', true))->>'error' = 'REQUEST_EXPIRED', 'expired request');
select t.check((select points from public.app_wallet() where name = 'Biryani House') = 100, 'kiran still has 100');
reset role;

-- expired points show in history
update public.point_lots set expires_at = now() - interval '1 day'
where customer_id = (select id from public.customers where mobile = '7353862216' and shop_id = :'ice');
select t.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set role authenticated;
select t.check(exists (select 1 from jsonb_array_elements((public.app_shop(:'ice'))->'history') h where h->>'kind' = 'expired' and h->>'points' = '20'), 'expired entry of 20');
select t.check((public.app_shop(:'ice'))->>'points' = '0', 'expired points gone');
reset role;

-- repeat-customer numbers
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
reset role;
update public.transactions set created_at = created_at - interval '2 days' where note = '2 Chicken Biryani, 1 Coke';
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.add_bill(:'bir', null, null, 800, null, false, :'priya_code');
select t.check((public.shop_dashboard(:'bir'))->>'repeat_30d' = '1', 'priya is a repeat customer');
select t.check((public.shop_dashboard(:'bir'))->>'followers' = '2', 'followers count');
reset role;
select 'ALL TESTS PASSED' as result;
