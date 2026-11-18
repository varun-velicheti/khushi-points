-- POS: the tables switch.
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
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'owner@cafe.in');
select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Juice Corner')).id as shop \gset
reset role;
update public.shops set biz_enabled = true where id = :'shop';
set role authenticated;
select t.check(((public.biz_menu(:'shop'))->'shop'->>'use_tables')::boolean, 'tables on by default');
select public.biz_save_settings(:'shop', '{"use_tables":false}');
select t.check(not ((public.biz_menu(:'shop'))->'shop'->>'use_tables')::boolean, 'tables switched off');
-- other settings leave it alone
select public.biz_save_settings(:'shop', '{"upi_id":"juice@okhdfc"}');
select t.check(not ((public.biz_menu(:'shop'))->'shop'->>'use_tables')::boolean, 'still off');
select public.biz_save_settings(:'shop', '{"use_tables":true}');
select t.check(((public.biz_menu(:'shop'))->'shop'->>'use_tables')::boolean, 'back on');
reset role;
select 'ALL TESTS PASSED' as result;
