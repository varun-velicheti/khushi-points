-- Shop logo and owner-deletes-shop. Fresh database with shim + migrations.
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
reset role;

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Biryani House')).id as bir \gset
select join_code as code from public.shops where id = :'bir' \gset
select public.add_bill(:'bir', '7353862216', null, 5000, null, true);
select public.send_offer(:'bir', 'Weekend 10% off', '', null);

-- owner sets a logo inside the shop's own folder; other paths are refused
select t.check(public._owns_logo_path(:'bir' || '/logo-1.jpg'), 'owner owns own folder');
select t.check(not public._owns_logo_path('not-a-shop/logo.jpg'), 'junk path refused');
select t.check((public.set_shop_logo(:'bir', :'bir' || '/logo-1.jpg')).logo_path = :'bir' || '/logo-1.jpg', 'logo saved');
select t.expect_error($$ select public.set_shop_logo('$$ || :'bir' || $$', '33333333-3333-3333-3333-333333333333/x.jpg') $$, 'BAD_LOGO');
select t.expect_error($$ select public.set_shop_logo('$$ || :'bir' || $$', '$$ || :'bir' || $$/../x.jpg') $$, 'BAD_LOGO');
reset role;

-- customer app shows the logo everywhere
select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select public.app_follow(:'bir', true);
select t.check((select logo_path from public.app_wallet()) = :'bir' || '/logo-1.jpg', 'wallet has logo');
select t.check((public.app_shop(:'bir'))->'shop'->>'logo_path' = :'bir' || '/logo-1.jpg', 'shop page has logo');
select t.check((select logo_path from public.app_offers() limit 1) = :'bir' || '/logo-1.jpg', 'offers have logo');
select t.check((select logo_path from public.app_activity(5) limit 1) = :'bir' || '/logo-1.jpg', 'activity has logo');
reset role;

-- cashiers and other owners cannot set the logo or delete the shop
select t.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
select public.join_shop(:'code');
select t.check(not public._owns_logo_path(:'bir' || '/logo-2.jpg'), 'cashier cannot upload');
select t.expect_error($$ select public.set_shop_logo('$$ || :'bir' || $$', null) $$, 'OWNER_ONLY');
select t.expect_error($$ select public.delete_shop('$$ || :'bir' || $$', 'Biryani House') $$, 'OWNER_ONLY');
reset role;
select t.as_user('33333333-3333-3333-3333-333333333333');
set role authenticated;
select t.check(not public._owns_logo_path(:'bir' || '/logo-2.jpg'), 'other owner cannot upload');
select t.expect_error($$ select public.delete_shop('$$ || :'bir' || $$', 'Biryani House') $$, 'OWNER_ONLY');
reset role;

-- owner must type the name; then everything for the shop is gone
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select t.check((public.set_shop_logo(:'bir', null)).logo_path is null, 'logo cleared');
select t.expect_error($$ select public.delete_shop('$$ || :'bir' || $$', 'Biryani') $$, 'CONFIRM_NAME');
select public.delete_shop(:'bir', '  biryani house ');
reset role;
select t.check(not exists (select 1 from public.shops where id = :'bir'), 'shop gone');
select t.check(not exists (select 1 from public.customers where shop_id = :'bir'), 'customers gone');
select t.check(not exists (select 1 from public.transactions where shop_id = :'bir'), 'bills gone');
select t.check(not exists (select 1 from public.shop_members where shop_id = :'bir'), 'staff gone');
select t.check(not exists (select 1 from public.offers where shop_id = :'bir'), 'offers gone');
select t.check((select customers from public.deleted_shops where shop_id = :'bir') = 1, 'admin record kept');

select t.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
set role authenticated;
select t.check((select count(*) from public.app_wallet()) = 0, 'shop gone from customer wallet');
reset role;
select 'ALL TESTS PASSED' as result;
