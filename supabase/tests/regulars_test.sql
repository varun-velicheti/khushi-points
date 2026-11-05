-- Visits and Regular status. Fresh database with shim + migrations.
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
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p917353862216@phone.khushipoints.app');
set role service_role;
select public.app_attach_phone('cccccccc-cccc-cccc-cccc-cccccccccccc', '7353862216');
insert into public.push_tokens values ('ExponentPushToken[kiran]', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'android', now());
reset role;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select t.check((public.update_shop_settings(:'bir', '{"regular_visits":3,"one_bill_per_day":false}')).regular_visits = 3, 'target saved');
select t.expect_error($$ select public.update_shop_settings('$$ || :'bir' || $$', '{"regular_visits":1}') $$, 'check constraint');
-- visit 1: 120 days ago (too old for the 90-day window); visits 2 and 3: 20 and 10 days ago
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as t1 \gset
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as t2 \gset
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as t3 \gset
reset role;
update public.transactions set created_at = now() - interval '120 days' where id = :'t1';
update public.transactions set created_at = now() - interval '20 days' where id = :'t2';
update public.transactions set created_at = now() - interval '10 days' where id = :'t3';

set role service_role;
select t.check((select visits_90d from public.push_targets_for_earn(:'t3')) = 2, 'two visits in 90 days');
reset role;

-- visit 4 (today) makes them a Regular; the notification knows it is a new visit
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as t4 \gset
-- a second bill the same day is not a new visit
select (public.add_bill(:'bir', '7353862216', null, 500, null, true))->>'txn_id' as t5 \gset
select t.check((select visits from public.list_customers(:'bir', null)) = 4, 'all-time visits are days');
select t.check((select visits_90d from public.list_customers(:'bir', null)) = 3, 'visits in 90 days');
select t.check((select is_regular from public.list_customers(:'bir', null)), 'regular in owner list');
select t.check((public.shop_dashboard(:'bir'))->>'regulars' = '1', 'dashboard counts regulars');
reset role;
set role service_role;
select t.check((select new_visit and visits_90d = regular_visits from public.push_targets_for_earn(:'t4')), 'became regular on t4');
select t.check((select not new_visit from public.push_targets_for_earn(:'t5')), 'same-day bill is not a new visit');
reset role;

select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select visits_90d from public.app_wallet()) = 3 and (select regular_visits from public.app_wallet()) = 3, 'wallet shows progress');
select t.check((public.app_shop(:'bir'))->>'is_regular' = 'true', 'shop page says regular');
select t.check((public.app_shop(:'bir'))->>'visits' = '4', 'shop page all-time visits');
reset role;

-- undoing today's bills takes the visit away again
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.reverse_transaction(:'bir', :'t5');
select public.reverse_transaction(:'bir', :'t4');
select t.check(not (select is_regular from public.list_customers(:'bir', null)), 'undo removes regular status');
reset role;
select 'ALL TESTS PASSED' as result;
