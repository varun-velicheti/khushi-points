-- Rewards that are not discounts. Fresh database with shim + migrations.
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

-- helper: a bill N days ago (each one a separate visit)
create function t.bill_days_ago(p_shop uuid, p_days int) returns bigint language plpgsql as $$
declare tid bigint;
begin
  perform t.as_user('11111111-1111-1111-1111-111111111111');
  tid := (public.add_bill(p_shop, '7353862216', null, 1000, null, true))->>'txn_id';
  update public.transactions set created_at = now() - make_interval(days => p_days) where transactions.id = tid;
  return tid;
end $$;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select join_code as code from public.shops where id = :'bir' \gset
select public.update_shop_settings(:'bir', '{"regular_visits":3,"one_bill_per_day":false}');
select public.add_reward(:'bir', 'Free masala chai', 'Any size', 'visits', 2) as chai \gset
select public.add_reward(:'bir', 'Free dessert', '', 'regular') as dessert \gset
select t.expect_error($$ select public.add_reward('$$ || :'bir' || $$', 'x', '', 'visits', null) $$, 'check constraint');
select public.add_reward(:'bir', 'R3', '', 'visits', 3) as r3 \gset
select public.add_reward(:'bir', 'R4', '', 'visits', 4) as r4 \gset
select public.add_reward(:'bir', 'R5', '', 'visits', 5) as r5 \gset
select t.expect_error($$ select public.add_reward('$$ || :'bir' || $$', 'R6', '', 'visits', 6) $$, 'REWARD_LIMIT');
select public.remove_reward(:'bir', :'r5');
select public.update_reward(:'bir', :'r3', 'R3', '', false);
select public.update_reward(:'bir', :'r4', 'R4', '', false);
select t.check((select count(*) from public.shop_rewards(:'bir') where active) = 2, 'two active rewards');
reset role;

-- cashier cannot manage rewards
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.add_reward('$$ || :'bir' || $$', 'Nope', '', 'visits', 2) $$, 'OWNER_ONLY');
reset role;

-- visit 1: nothing. visit 2: chai. visit 3: chai? no (3 % 2). becomes Regular -> dessert.
select t.bill_days_ago(:'bir', 30) as v1 \gset
select t.check((select count(*) from public.reward_grants) = 0, 'visit 1 unlocks nothing');
select t.bill_days_ago(:'bir', 20) as v2 \gset
select t.check((select title from public.reward_grants where txn_id = :'v2') = 'Free masala chai', 'visit 2 unlocks chai');
reset role;
select t.check((select count(*) from public.reward_grants where reward_id in (select id from public.rewards where title in ('R3','R4'))) = 0, 'paused rewards unlock nothing');

-- visit 3 today -> Regular -> dessert; notification names it
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.add_bill(:'bir', '7353862216', null, 1000, null, true))->>'txn_id' as v3 \gset
reset role;
select t.check((select title from public.reward_grants where txn_id = :'v3') = 'Free dessert', 'becoming regular unlocks dessert');
-- a second bill the same day is not a new visit
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.add_bill(:'bir', '7353862216', null, 300, null, true))->>'txn_id' as same \gset
reset role;
select t.check((select count(*) from public.reward_grants where txn_id = :'same') = 0, 'same-day bill unlocks nothing');
set role service_role;
select t.check((select rewards from public.push_targets_for_earn(:'v3')) = 'Free dessert', 'notification names reward');
reset role;

-- customer sees rewards waiting and progress
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select rewards_ready from public.app_wallet()) = 2, 'wallet: 2 rewards ready');
select t.check(jsonb_array_length((public.app_shop(:'bir'))->'rewards') = 2, 'shop page lists rewards');
select t.check((select (p->>'visits_left')::int from jsonb_array_elements((public.app_shop(:'bir'))->'programs') p where p->>'title' = 'Free masala chai') = 1, 'one visit to next chai');
reset role;

-- cashier gives the chai at the counter; it cannot be given twice
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.check((select count(*) from public.customer_rewards(:'bir', '7353862216')) = 2, 'counter sees 2 rewards');
select grant_id as g from public.customer_rewards(:'bir', '7353862216') where title = 'Free masala chai' \gset
select public.use_reward(:'bir', :'g');
select t.expect_error($$ select public.use_reward('$$ || :'bir' || $$', $$ || :'g' || $$) $$, 'REWARD_USED');
select t.check((select count(*) from public.customer_rewards(:'bir', '7353862216')) = 1, 'one left');
select t.check((select given_30d from public.shop_rewards(:'bir') where title = 'Free masala chai') = 1, 'owner sees it given');
reset role;

-- undoing the bill takes back the unused dessert
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.reverse_transaction(:'bir', :'v3');
select t.check((select count(*) from public.customer_rewards(:'bir', '7353862216')) = 0, 'undo takes back unused reward');
reset role;

-- expired rewards cannot be given
update public.reward_grants set expires_at = now() - interval '1 day', used_at = null where id = :'g';
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select t.expect_error($$ select public.use_reward('$$ || :'bir' || $$', $$ || :'g' || $$) $$, 'REWARD_EXPIRED');
reset role;
select 'ALL TESTS PASSED' as result;
