-- Earned-points notification targets, expiry reminders, POS bills. Fresh database with shim + migrations.
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
  ('11111111-1111-1111-1111-111111111111', 'owner@biryani.in'),
  ('22222222-2222-2222-2222-222222222222', 'cashier@biryani.in'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p917353862216@phone.khushipoints.app');
set role service_role;
select public.app_attach_phone('cccccccc-cccc-cccc-cccc-cccccccccccc', '7353862216');
insert into public.push_tokens values ('ExponentPushToken[kiran]', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'android', now());
reset role;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select join_code as code from public.shops where id = :'bir' \gset
-- reminder days are saved, largest first, duplicates removed
select t.check((public.update_shop_settings(:'bir', '{"reminder_days":[1,7,7]}')).reminder_days = '{7,1}', 'reminder days saved');
select t.expect_error($$ select public.update_shop_settings('$$ || :'bir' || $$', '{"reminder_days":[90]}') $$, 'check constraint');

-- counter bill -> earned notification goes to the customer's phone
select (public.add_bill(:'bir', '7353862216', null, 5000, null, true))->>'txn_id' as txn \gset
reset role;
set role service_role;
select t.check((select count(*) from public.push_targets_for_earn(:'txn')) = 1, 'earn push target');
select t.check((select points from public.push_targets_for_earn(:'txn')) = 100, 'earn push says 100 points');
reset role;

-- POS key: owner only, shown once, old key stops working
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.new_pos_key('$$ || :'bir' || $$') $$, 'OWNER_ONLY');
reset role;
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.new_pos_key(:'bir') as oldkey \gset
select public.new_pos_key(:'bir') as key \gset
select t.check((public.pos_key_status(:'bir'))->>'hint' = right(:'key', 4), 'hint shows last 4');
select t.expect_error('select * from public.shop_pos_keys', 'permission denied');
reset role;

-- a POS bill: no staff login, points + notification, same daily rule
set role service_role;
select t.expect_error($$ select public.pos_add_bill('$$ || :'oldkey' || $$', '7353862216', 900) $$, 'BAD_POS_KEY');
select t.expect_error($$ select public.pos_add_bill('kp_live_wrong', '7353862216', 900) $$, 'BAD_POS_KEY');
select (public.pos_add_bill(:'key', '+91 73538 62216', 8000, 'PP-5521', '2 Mutton Biryani'))->>'txn_id' as ptxn \gset
select t.check((select points from public.push_targets_for_earn(:'ptxn')) = 60, 'POS bill tops up 60 (8000 earns 160, 100 given today)');
select t.check((select source from public.transactions where id = :'ptxn') = 'pos', 'source pos');
select t.expect_error($$ select public.pos_add_bill('$$ || :'key' || $$', '7353862216', 8000, 'PP-5521') $$, 'BILL_ALREADY_USED');
-- a new number from the POS becomes a customer
select t.check((public.pos_add_bill(:'key', '9848012345', 1500))->>'is_new' = 'true', 'POS adds new customer');
reset role;
set role authenticated;
select t.expect_error($$ select public.pos_add_bill('x', '9848012345', 1500) $$, 'permission denied');
reset role;

-- the customer app shows the activity
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select count(*) from public.app_activity(10)) = 2, 'two activities');
select t.check((select points from public.app_activity(1)) = 60, 'latest is the POS top-up');
reset role;

-- expiry reminders: 7 days and 1 day before, once each, only for app users with reminders on
update public.point_lots set expires_at = (((now() at time zone 'Asia/Kolkata')::date + 7) + time '20:00') at time zone 'Asia/Kolkata'
where customer_id = (select id from public.customers where mobile = '7353862216');
set role service_role;
select t.check((select count(*) from public.expiry_reminders_due()) = 1, 'one 7-day reminder');
select t.check((select title from public.expiry_reminders_due()) is null, 'not sent twice');
reset role;
update public.point_lots set expires_at = (((now() at time zone 'Asia/Kolkata')::date + 1) + time '09:00') at time zone 'Asia/Kolkata'
where customer_id = (select id from public.customers where mobile = '7353862216');
set role service_role;
create temp table r1 as select * from public.expiry_reminders_due();
select t.check((select title from r1) = '160 points at Biryani House expire tomorrow', 'tomorrow wording: ' || coalesce((select title from r1), 'none'));
reset role;
-- reminders off: nothing sent
update public.reminder_log set expires_on = expires_on - 30;
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select public.app_set_reminders(false);
select t.check((public.app_me())->>'reminders' = 'false', 'reminders off');
reset role;
set role service_role;
select t.check((select count(*) from public.expiry_reminders_due()) = 0, 'no reminder when off');
reset role;
select 'ALL TESTS PASSED' as result;
