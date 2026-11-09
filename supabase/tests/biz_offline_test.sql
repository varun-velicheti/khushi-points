-- Khushi Biz step 3: offline invoice series. Fresh database with shim + migrations.
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
select (public.create_shop('Chai Adda')).id as shop \gset
reset role;
update public.shops set biz_enabled = true where id = :'shop';
set role authenticated;
-- an online bill before any device claimed a series (old way, series A)
select public.biz_save_order(:'shop', '{"id":"cccccccc-0000-0000-0000-000000000001","kind":"takeaway","lines":[{"name":"Chai","price":30,"qty":1,"gst_rate":5}]}');
select public.biz_pay_order(:'shop', 'cccccccc-0000-0000-0000-000000000001', 'cash');
-- first device gets A and continues after the existing invoice; second device gets B
select t.check((public.biz_claim_series(:'shop', 'Counter'))->>'series' = 'A', 'first device A');
select t.check(((public.biz_claim_series(:'shop', 'Counter', 'A'))->>'last')::int = 1, 'A continues from 1');
select t.check((public.biz_claim_series(:'shop', 'Tablet'))->>'series' = 'B', 'second device B');
select t.check((public.biz_claim_series(:'shop', 'Phone', 'Z'))->>'series' = 'C', 'unknown series: next free');
-- device B pays offline with its own number and the time it was paid
select public.biz_save_order(:'shop', '{"id":"cccccccc-0000-0000-0000-000000000002","kind":"takeaway","lines":[{"name":"Chai","price":30,"qty":2,"gst_rate":5}]}');
select public.biz_pay_order(:'shop', 'cccccccc-0000-0000-0000-000000000002', 'upi', 'B', false, 1, now() - interval '2 hours') as p \gset
select t.check((:'p'::jsonb)->>'invoice_no' ~ '^B[0-9]{4}-0001$', 'device number used');
select t.check(((:'p'::jsonb)->>'paid_at')::timestamptz < now() - interval '1 hour', 'offline paid time kept');
select t.check(((public.biz_claim_series(:'shop', '', 'B'))->>'last')::int = 1, 'server knows B is at 1');
-- sending the same payment again: same invoice (safe to repeat)
select t.check((public.biz_pay_order(:'shop', 'cccccccc-0000-0000-0000-000000000002', 'upi', 'B', false, 1))->>'invoice_no' = (:'p'::jsonb)->>'invoice_no', 'repeat is harmless');
-- another order cannot reuse B-0001; an unclaimed series is refused; future times are clamped
select public.biz_save_order(:'shop', '{"id":"cccccccc-0000-0000-0000-000000000003","kind":"takeaway","lines":[{"name":"Chai","price":30,"qty":1,"gst_rate":5}]}');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', 'cccccccc-0000-0000-0000-000000000003', 'cash', 'B', false, 1) $$, 'INVOICE_TAKEN');
select t.expect_error($$ select public.biz_pay_order('$$ || :'shop' || $$', 'cccccccc-0000-0000-0000-000000000003', 'cash', 'Q', false, 1) $$, 'BAD_SERIES');
select t.check(((public.biz_pay_order(:'shop', 'cccccccc-0000-0000-0000-000000000003', 'cash', 'B', false, 2, now() + interval '3 days'))->>'paid_at')::timestamptz <= now(), 'future time clamped');
select t.check((public.biz_menu(:'shop'))->'shop'->>'timezone' = 'Asia/Kolkata', 'menu has time zone');
reset role;
select 'ALL TESTS PASSED' as result;
