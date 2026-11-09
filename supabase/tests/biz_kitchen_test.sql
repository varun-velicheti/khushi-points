-- Khushi Biz step 2: kitchen tickets. Fresh database with shim + migrations.
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
  ('11111111-1111-1111-1111-111111111111', 'owner@cafe.in'),
  ('33333333-3333-3333-3333-333333333333', 'owner@other.in');

select t.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
select (public.create_shop('Chai Adda')).id as shop \gset
select public.biz_save_table(:'shop', null, 'T1', 1) as t1 \gset
select t.check(((public.biz_menu(:'shop'))->'shop'->>'kitchen')::boolean = false, 'kitchen off by default');
select public.biz_save_settings(:'shop', '{"kitchen":true}');
select t.check(((public.biz_menu(:'shop'))->'shop'->>'kitchen')::boolean, 'kitchen switched on');
-- order: 2 chai, 1 samosa (no spice)
select public.biz_save_order(:'shop', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','table_id',:'t1','lines',
  '[{"item_id":"11111111-aaaa-0000-0000-000000000001","name":"Masala chai","price":30,"qty":2,"gst_rate":5},
    {"item_id":"11111111-aaaa-0000-0000-000000000002","name":"Samosa","price":40,"qty":1,"gst_rate":5,"note":"no spice"}]'::jsonb));
select public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') as k1 \gset
select t.check(((:'k1'::jsonb)->>'no')::int = 1, 'first ticket #1');
select t.check(jsonb_array_length((:'k1'::jsonb)->'lines') = 2, 'two dishes');
select t.check(public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') is null, 'nothing new, no ticket');
select t.check((public.biz_invoice(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001'))->'sent'->>'11111111-aaaa-0000-0000-000000000001|' = '2', 'order knows 2 chai sent');
-- add 1 chai, remove samosa -> ticket #2: +1 chai, -1 samosa
select public.biz_save_order(:'shop', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','table_id',:'t1','lines',
  '[{"item_id":"11111111-aaaa-0000-0000-000000000001","name":"Masala chai","price":30,"qty":3,"gst_rate":5}]'::jsonb));
select public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') as k2 \gset
select t.check(((:'k2'::jsonb)->>'no')::int = 2, 'second ticket #2');
select t.check((select (l->>'qty')::int from jsonb_array_elements((:'k2'::jsonb)->'lines') l where l->>'name' = 'Masala chai') = 1, '+1 chai');
select t.check((select (l->>'qty')::int from jsonb_array_elements((:'k2'::jsonb)->'lines') l where l->>'name' = 'Samosa') = -1, 'samosa cancelled');
select t.check((select l->>'note' from jsonb_array_elements((:'k2'::jsonb)->'lines') l where l->>'name' = 'Samosa') = 'no spice', 'cancel keeps note');
-- kitchen moves tickets along; the floor sees "ready"
select t.check(jsonb_array_length(public.biz_kitchen(:'shop')) = 2, 'kitchen has 2 tickets');
select public.biz_ticket_status(:'shop', ((:'k1'::jsonb)->>'id')::uuid, 'ready');
select t.check((public.biz_open_orders(:'shop'))->0->>'kitchen' = 'ready', 'floor: ready to serve');
select public.biz_ticket_status(:'shop', ((:'k1'::jsonb)->>'id')::uuid, 'done');
select public.biz_ticket_status(:'shop', ((:'k2'::jsonb)->>'id')::uuid, 'done');
select t.check(jsonb_array_length(public.biz_kitchen(:'shop')) = 0, 'all done');
select t.check((public.biz_open_orders(:'shop'))->0->>'kitchen' is null, 'floor: nothing pending');
select t.expect_error($$ select public.biz_ticket_status('$$ || :'shop' || $$', '$$ || ((:'k1'::jsonb)->>'id') || $$', 'eaten') $$, 'BAD_STATUS');
-- cancelled order: its open tickets show as cancelled in the kitchen
select public.biz_save_order(:'shop', '{"id":"bbbbbbbb-0000-0000-0000-000000000002","kind":"takeaway","lines":[{"name":"Bun maska","price":45,"qty":1,"gst_rate":5}]}');
select public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000002');
select public.biz_cancel_order(:'shop', 'bbbbbbbb-0000-0000-0000-000000000002');
select t.check(((public.biz_kitchen(:'shop'))->0->>'cancelled')::boolean, 'kitchen sees cancelled order');
select t.check(((public.biz_kitchen(:'shop'))->0->>'no')::int = 3, 'ticket #3');
reset role;
select t.as_user('33333333-3333-3333-3333-333333333333');
set role authenticated;
select t.expect_error($$ select public.biz_kitchen('$$ || :'shop' || $$') $$, 'NOT_A_MEMBER');
reset role;
select 'ALL TESTS PASSED' as result;
