-- POS item options: save, validate, order lines with options, kitchen labels, totals, stock.
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
update public.shops set biz_enabled = true, biz_kitchen = true where id = :'shop';
set role authenticated;
select public.biz_save_table(:'shop', null, 'T1', 1) as t1 \gset

-- an item with a size (pick one) and add-ons (pick many)
select public.biz_save_item(:'shop', '{"name":"Masala chai","price":30,"gst_rate":5,"options":[
  {"name":" Size ","pick":"one","choices":[{"name":"Small","price":0},{"name":"Large","price":15}]},
  {"name":"Add-ons","pick":"many","choices":[{"name":"Ginger"},{"name":"Elaichi","price":5}]}]}'::jsonb) as chai \gset
select t.check(jsonb_array_length(i->'options') = 2 and i->'options'->0->>'name' = 'Size'
  and (i->'options'->1->'choices'->0->>'price')::numeric = 0, 'menu returns cleaned options')
from jsonb_array_elements((public.biz_menu(:'shop'))->'items') i where i->>'id' = :'chai';
-- saving without options clears them; old items default to none
select public.biz_save_item(:'shop', '{"name":"Samosa","price":20}'::jsonb) as samosa \gset
select t.check(i->'options' = '[]'::jsonb, 'no options by default')
from jsonb_array_elements((public.biz_menu(:'shop'))->'items') i where i->>'id' = :'samosa';

-- bad options
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":1,"options":[{"name":"","choices":[{"name":"a"}]}]}') $$, 'BAD_OPTIONS');
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":1,"options":[{"name":"S","pick":"some","choices":[{"name":"a"}]}]}') $$, 'BAD_OPTIONS');
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":1,"options":[{"name":"S","choices":[]}]}') $$, 'BAD_OPTIONS');
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":1,"options":[{"name":"S","choices":[{"name":"a","price":-1}]}]}') $$, 'BAD_OPTIONS');
select t.expect_error($$ select public.biz_save_item('$$ || :'shop' || $$', '{"name":"X","price":1,"options":{"a":1}}') $$, 'BAD_OPTIONS');

-- order: 1 large chai with ginger (price 45), 2 small chai, 1 samosa
select public.biz_save_order(:'shop', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','table_id',:'t1','lines',
  jsonb_build_array(
    jsonb_build_object('item_id',:'chai','name','Masala chai','price',45,'qty',1,'gst_rate',5,'opts',jsonb_build_array('Large',' Ginger ','')),
    jsonb_build_object('item_id',:'chai','name','Masala chai','price',30,'qty',2,'gst_rate',5,'opts',jsonb_build_array('Small')),
    jsonb_build_object('item_id',:'samosa','name','Samosa','price',20,'qty',1,'gst_rate',5,'opts','[]'::jsonb,'note','less spicy'))));
select public.biz_invoice(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') as inv \gset
select t.check((:'inv'::jsonb)->'lines'->0->'opts' = '["Large","Ginger"]'::jsonb, 'options kept and trimmed');
select t.check(not ((:'inv'::jsonb)->'lines'->2 ? 'opts'), 'no empty opts kept');
select t.check((:'inv'::jsonb)->'lines'->2->>'note' = 'less spicy', 'note kept');
select t.check(((:'inv'::jsonb)->'totals'->>'total')::numeric = 125, 'total includes option prices');
-- too many options on a line
select t.expect_error($$ select public.biz_save_order('$$ || :'shop' || $$', '{"id":"bbbbbbbb-0000-0000-0000-000000000002","kind":"takeaway","lines":[{"name":"A","price":1,"qty":1,"gst_rate":5,"opts":["1","2","3","4","5","6","7","8","9"]}]}') $$, 'BAD_LINES');
select t.expect_error($$ select public.biz_save_order('$$ || :'shop' || $$', '{"id":"bbbbbbbb-0000-0000-0000-000000000002","kind":"takeaway","lines":[{"name":"A","price":1,"qty":1,"gst_rate":5,"opts":"Large"}]}') $$, 'BAD_LINES');

-- kitchen: large and small chai are separate lines with readable labels
select public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') as k1 \gset
select t.check(jsonb_array_length((:'k1'::jsonb)->'lines') = 3, 'three kitchen lines');
select t.check((:'k1'::jsonb)->'lines'->0->>'name' = 'Masala chai (Large, Ginger)', 'label shows options');
select t.check((:'k1'::jsonb)->'lines'->1->>'name' = 'Masala chai (Small)', 'small chai separate');
select t.check((:'k1'::jsonb)->'lines'->2->>'name' = 'Samosa' and (:'k1'::jsonb)->'lines'->2->>'note' = 'less spicy', 'plain item and note');
-- drop the large chai -> ticket says -1 of it
select public.biz_save_order(:'shop', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','table_id',:'t1','lines',
  jsonb_build_array(
    jsonb_build_object('item_id',:'chai','name','Masala chai','price',30,'qty',2,'gst_rate',5,'opts',jsonb_build_array('Small')),
    jsonb_build_object('item_id',:'samosa','name','Samosa','price',20,'qty',1,'gst_rate',5,'note','less spicy'))));
select public.biz_send_to_kitchen(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001') as k2 \gset
select t.check(jsonb_array_length((:'k2'::jsonb)->'lines') = 1 and ((:'k2'::jsonb)->'lines'->0->>'qty')::numeric = -1
  and (:'k2'::jsonb)->'lines'->0->>'name' = 'Masala chai (Large, Ginger)', 'removed option line goes back to kitchen');

-- stock counts every chai, whatever its options
select public.biz_stock_track(:'shop', :'chai', true);
select public.biz_stock_add(:'shop', :'chai', 10);
select public.biz_claim_series(:'shop', 'Counter', 'A');
select public.biz_pay_order(:'shop', 'bbbbbbbb-0000-0000-0000-000000000001', 'cash', 'A');
select t.check((i->>'stock')::numeric = 8, 'stock down by 2 chai')
from jsonb_array_elements((public.biz_menu(:'shop'))->'items') i where i->>'id' = :'chai';
reset role;
select 'ALL TESTS PASSED' as result;
