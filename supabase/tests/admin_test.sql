-- Admin view tests. Run on a fresh database with shim + migrations.
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

-- the founder's email becomes admin automatically on sign-up; others do not
insert into auth.users values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'VarunKumarVelicheti@gmail.com'),
  ('11111111-1111-1111-1111-111111111111', 'owner1@shop.in'),
  ('22222222-2222-2222-2222-222222222222', 'owner2@shop.in');
select t.check((select count(*) from public.platform_admins) = 1, 'only founder is admin');

-- two shops with some activity
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Sahasra Clothing')).id as s1 \gset
select public.add_bill(:'s1', '7353862216', 'B-1', 5000, null, true);
select public.add_bill(:'s1', '9848012345', 'B-2', 2000, null, true);
select t.expect_error('select public.admin_overview()', 'ADMIN_ONLY');
select t.expect_error('select * from public.admin_shops()', 'ADMIN_ONLY');
select t.check(public.is_platform_admin() = false, 'owner is not admin');
select t.as_user('22222222-2222-2222-2222-222222222222');
select (public.create_shop('Lakshmi Kirana')).id as s2 \gset
reset role;

-- admin sees totals, no customer numbers
select t.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select t.check(public.is_platform_admin(), 'founder is admin');
select t.check((public.admin_overview())->>'shops' = '2', '2 shops');
select t.check((public.admin_overview())->>'shops_active_7d' = '1', '1 active shop');
select t.check((public.admin_overview())->>'bills_today' = '2', '2 bills today');
select t.check(jsonb_array_length((public.admin_overview())->'bills_by_day') = 14, '14 days of bills');
select t.check(((public.admin_overview())->'bills_by_day'->>13) = '2', 'today is last');
select t.check((select name from public.admin_shops() limit 1) = 'Sahasra Clothing', 'most active first');
select t.check((select owner_email from public.admin_shops() where name = 'Lakshmi Kirana') = 'owner2@shop.in', 'owner email');
select t.check((select customers from public.admin_shops() where name = 'Sahasra Clothing') = 2, '2 customers');
select t.check((select bills_by_day[14] from public.admin_shops() where name = 'Sahasra Clothing') = 2, 'per-shop days');
select t.check((select last_activity from public.admin_shops() where name = 'Lakshmi Kirana') is null, 'new shop has no activity');
-- the admin view does not include customer mobile numbers anywhere
select t.check(position('7353862216' in (public.admin_overview())::text) = 0, 'no numbers in overview');
select t.check(position('7353862216' in (select string_agg(r::text, '') from public.admin_shops() r)) = 0, 'no numbers in shop list');
-- admin cannot read other shops' raw tables
select t.check((select count(*) from public.customers) = 0, 'no raw customer access');
reset role;
select 'ALL TESTS PASSED' as result;
