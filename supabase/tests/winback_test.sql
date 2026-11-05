-- Win-back notes. Fresh database with shim + migrations.
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
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p917353862216@phone.khushipoints.app'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'p919848012345@phone.khushipoints.app');
set role service_role;
select public.app_attach_phone('cccccccc-cccc-cccc-cccc-cccccccccccc', '7353862216');
select public.app_attach_phone('dddddddd-dddd-dddd-dddd-dddddddddddd', '9848012345');
insert into public.push_tokens values ('ExponentPushToken[kiran]', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'android', now());
reset role;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select join_code as code from public.shops where id = :'bir' \gset
-- Kiran (app) last came 45 days ago; Priya (app) came yesterday; a walk-in without the app 50 days ago
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as k1 \gset
select (public.add_bill(:'bir', '9848012345', null, 1000, null, true))->>'txn_id' as p1 \gset
select (public.add_bill(:'bir', '9000000001', null, 1000, 'Ravi', true))->>'txn_id' as w1 \gset
select public.add_reward(:'bir', 'Free dessert', '', 'visits', 10) as gift \gset
reset role;
update public.transactions set created_at = now() - interval '45 days' where id = :'k1';
update public.transactions set created_at = now() - interval '1 day' where id = :'p1';
update public.transactions set created_at = now() - interval '50 days' where id = :'w1';

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.winback_preview(:'bir'))->>'lapsed' = '2', 'two lapsed');
select t.check((public.winback_preview(:'bir'))->>'reachable' = '1', 'only Kiran reachable (app)');
select t.check((public.winback_preview(:'bir'))->>'not_reachable' = '1', 'walk-in not reachable');
select t.expect_error($$ select public.send_winback('$$ || :'bir' || $$', 'Hi') $$, 'check constraint');
select (public.send_winback(:'bir', 'We miss you! Come by this week.', :'gift'))->>'winback_id' as wb \gset
select t.check((select recipients from public.shop_winbacks(:'bir')) = 1, 'sent to one');
select t.expect_error($$ select public.send_winback('$$ || :'bir' || $$', 'Again so soon') $$, 'WINBACK_LIMIT');
select t.check((select count(*) from public.customer_rewards(:'bir', '7353862216')) = 1, 'gift waiting for Kiran');
reset role;

set role service_role;
select t.check((select gift_title from public.push_targets_for_winback(:'wb')) = 'Free dessert', 'push names the gift');
select t.check((select count(*) from public.push_targets_for_winback(:'wb')) = 1, 'one phone');
reset role;

-- Kiran sees the note; Priya does not
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((public.app_shop_note(:'bir'))->>'message' = 'We miss you! Come by this week.', 'kiran sees note');
reset role;
select t.as_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
set role authenticated;
select t.check(public.app_shop_note(:'bir') is null, 'priya sees no note');
reset role;

-- a week later nobody new is reachable: Kiran already had a note within 60 days
update public.winbacks set created_at = now() - interval '8 days' where id = :'wb';
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.winback_preview(:'bir'))->>'reachable' = '0', '60-day cooldown');
select t.expect_error($$ select public.send_winback('$$ || :'bir' || $$', 'Anyone there?') $$, 'NO_ONE_TO_WIN_BACK');
-- Kiran comes back -> counted
select public.add_bill(:'bir', '7353862216', null, 1000, null, true);
select t.check((select came_back from public.shop_winbacks(:'bir')) = 1, 'came back counted');
reset role;

-- cashier cannot send
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.winback_preview('$$ || :'bir' || $$') $$, 'OWNER_ONLY');
select t.expect_error($$ select public.send_winback('$$ || :'bir' || $$', 'Hello there') $$, 'OWNER_ONLY');
reset role;
select 'ALL TESTS PASSED' as result;
