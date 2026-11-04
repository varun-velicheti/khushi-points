-- Edit and remove offers. Fresh database with shim + migrations.
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
  ('33333333-3333-3333-3333-333333333333', 'owner@icecream.in'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p917353862216@phone.khushipoints.app');
set role service_role;
select public.app_attach_phone('cccccccc-cccc-cccc-cccc-cccccccccccc', '7353862216');
insert into public.push_tokens values ('ExponentPushToken[kiran]', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'android', now());
reset role;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select join_code as code from public.shops where id = :'bir' \gset
select public.add_bill(:'bir', '7353862216', null, 5000, null, true);   -- Kiran follows
select (public.send_offer(:'bir', 'Weekend 10% off', 'Fri-Sun', current_date + 3))->>'offer_id' as o1 \gset

-- edit: text changes in the app, no new notification target list change, marked edited
select public.update_offer(:'bir', :'o1', 'Weekend 15% off', 'Fri to Sun, dine-in', current_date + 5);
select t.check((select edited_at from public.shop_offers(:'bir') where id = :'o1') is not null, 'marked edited');
select t.expect_error($$ select public.update_offer('$$ || :'bir' || $$', $$ || :'o1' || $$, 'x', '', current_date - 1) $$, 'BAD_DATE');
select t.expect_error($$ select public.update_offer('$$ || :'bir' || $$', 999, 'Nope') $$, 'NO_OFFER');
reset role;

select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select title from public.app_offers()) = 'Weekend 15% off', 'customer sees edited title');
select t.check((public.app_shop(:'bir'))->'offers'->0->>'edited_at' is not null, 'shop page shows edited');
reset role;

-- only the owner of that shop can edit or remove
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.expect_error($$ select public.remove_offer('$$ || :'bir' || $$', $$ || :'o1' || $$) $$, 'OWNER_ONLY');
select t.expect_error($$ select public.update_offer('$$ || :'bir' || $$', $$ || :'o1' || $$, 'Cashier edit') $$, 'OWNER_ONLY');
reset role;
select t.as_user('33333333-3333-3333-3333-333333333333');
set role authenticated;
select (public.create_shop('Cream Stone')).id as ice \gset
select t.expect_error($$ select public.remove_offer('$$ || :'ice' || $$', $$ || :'o1' || $$) $$, 'NO_OFFER');
reset role;

-- remove: gone from the app and from notifications, still counts toward the weekly limit
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select public.remove_offer(:'bir', :'o1');
select t.expect_error($$ select public.remove_offer('$$ || :'bir' || $$', $$ || :'o1' || $$) $$, 'NO_OFFER');
select t.expect_error($$ select public.update_offer('$$ || :'bir' || $$', $$ || :'o1' || $$, 'Back again') $$, 'NO_OFFER');
select t.check((select removed_at from public.shop_offers(:'bir') where id = :'o1') is not null, 'owner sees it as removed');
select public.send_offer(:'bir', 'Free Coke');
select t.expect_error($$ select public.send_offer('$$ || :'bir' || $$', 'Third this week') $$, 'OFFER_LIMIT');
reset role;
set role service_role;
select t.check((select count(*) from public.push_targets_for_offer(:'o1')) = 0, 'no push for removed offer');
reset role;
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select count(*) from public.app_offers()) = 1, 'customer sees only the live offer');
select t.check((select latest_offer from public.app_wallet()) = 'Free Coke', 'wallet shows live offer');
select t.check(jsonb_array_length((public.app_shop(:'bir'))->'offers') = 1, 'shop page hides removed');
reset role;
select 'ALL TESTS PASSED' as result;
