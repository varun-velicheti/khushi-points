-- POS: item options (sizes, add-ons) and kitchen labels that show them.
-- An item has option groups: {name, pick: 'one' | 'many', choices: [{name, price}]}; a choice's price is added to the item's.
-- An order line keeps the picked choice names in `opts` and its price already includes the extras,
-- so bill totals, GST, points and stock work unchanged.

alter table public.menu_items add column options jsonb not null default '[]' check (jsonb_typeof(options) = 'array');

create or replace function public._biz_clean_options(p jsonb)
returns jsonb language plpgsql immutable as $$
declare g jsonb; c jsonb; out jsonb := '[]'; choices jsonb;
begin
  p := coalesce(p, '[]');
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 6 then raise exception 'BAD_OPTIONS'; end if;
  for g in select * from jsonb_array_elements(p) loop
    if char_length(trim(coalesce(g->>'name', ''))) not between 1 and 30 or coalesce(g->>'pick', 'one') not in ('one', 'many')
       or jsonb_typeof(g->'choices') is distinct from 'array' or jsonb_array_length(g->'choices') not between 1 and 12 then
      raise exception 'BAD_OPTIONS';
    end if;
    choices := '[]';
    for c in select * from jsonb_array_elements(g->'choices') loop
      if char_length(trim(coalesce(c->>'name', ''))) not between 1 and 30
         or coalesce((c->>'price')::numeric, 0) not between 0 and 100000 then
        raise exception 'BAD_OPTIONS';
      end if;
      choices := choices || jsonb_build_object('name', trim(c->>'name'), 'price', coalesce((c->>'price')::numeric, 0));
    end loop;
    out := out || jsonb_build_object('name', trim(g->>'name'), 'pick', coalesce(g->>'pick', 'one'), 'choices', choices);
  end loop;
  return out;
end $$;

create or replace function public.biz_save_item(p_shop uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare iid uuid; cat uuid := nullif(p->>'category_id', '')::uuid; opts jsonb := _biz_clean_options(p->'options');
begin
  perform _require_member(p_shop, true);
  if cat is not null and not exists (select 1 from menu_categories where id = cat and shop_id = p_shop) then raise exception 'NOT_FOUND'; end if;
  insert into menu_items (id, shop_id, category_id, name, price, gst_rate, hsn, veg, available, sort, options)
  values (coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), p_shop, cat, trim(p->>'name'), (p->>'price')::numeric,
    coalesce((p->>'gst_rate')::numeric, 5), nullif(trim(coalesce(p->>'hsn', '')), ''), coalesce((p->>'veg')::boolean, true),
    coalesce((p->>'available')::boolean, true), coalesce((p->>'sort')::int, 0), opts)
  on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, price = excluded.price,
    gst_rate = excluded.gst_rate, hsn = excluded.hsn, veg = excluded.veg, available = excluded.available, sort = excluded.sort,
    options = excluded.options
    where menu_items.shop_id = p_shop and menu_items.archived_at is null
  returning id into iid;
  if iid is null then raise exception 'NOT_FOUND'; end if;
  return iid;
end $$;

create or replace function public.biz_menu(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  if not s.biz_enabled then raise exception 'BIZ_NOT_ENABLED'; end if;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'legal_name', s.legal_name, 'gstin', s.gstin, 'address', s.address,
      'contact_phone', s.contact_phone, 'gst_inclusive', s.gst_inclusive, 'upi_id', s.upi_id,
      'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct, 'logo_path', s.logo_path, 'kitchen', s.biz_kitchen, 'timezone', s.timezone),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from menu_categories where shop_id = p_shop), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'price', price,
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort,
        'track_stock', track_stock, 'stock', stock, 'low_stock', low_stock, 'options', options) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'));
end $$;

-- Lines now keep the picked option names (`opts`, at most 8) next to the note.
create or replace function public._biz_clean_lines(p_lines jsonb)
returns jsonb language plpgsql immutable as $$
declare l jsonb; out jsonb := '[]'; opts jsonb;
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 200 then raise exception 'BAD_LINES'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    if coalesce(l->>'name', '') = '' or char_length(l->>'name') > 60
       or l->>'price' is null or l->>'qty' is null or l->>'gst_rate' is null
       or (l->>'price')::numeric < 0 or (l->>'qty')::numeric <= 0 or (l->>'qty')::numeric > 999
       or (l->>'gst_rate')::numeric not in (0, 5, 12, 18, 28)
       or (l ? 'opts' and l->'opts' <> 'null' and (jsonb_typeof(l->'opts') <> 'array' or jsonb_array_length(l->'opts') > 8)) then
      raise exception 'BAD_LINES';
    end if;
    select coalesce(jsonb_agg(left(trim(o), 40)) filter (where trim(o) <> ''), '[]') into opts
    from jsonb_array_elements_text(case when jsonb_typeof(l->'opts') = 'array' then l->'opts' else '[]' end) o;
    out := out || jsonb_build_array(jsonb_build_object('item_id', l->'item_id', 'name', l->>'name', 'price', (l->>'price')::numeric,
      'qty', (l->>'qty')::numeric, 'gst_rate', (l->>'gst_rate')::numeric, 'hsn', l->>'hsn',
      'note', nullif(left(coalesce(l->>'note', ''), 100), ''))
      || case when jsonb_array_length(opts) > 0 then jsonb_build_object('opts', opts) else '{}'::jsonb end);
  end loop;
  return out;
end $$;

-- "Chai (Large)" and "Chai (Small)" are different lines for the kitchen. Lines without options keep their old key.
create or replace function public._biz_line_key(l jsonb)
returns text language sql immutable as $$
  select coalesce(l->>'item_id', l->>'name') || '|' || coalesce(l->>'note', '')
    || coalesce('|' || nullif((select string_agg(o, ', ') from jsonb_array_elements_text(coalesce(l->'opts', '[]')) o), ''), '');
$$;

-- What the kitchen reads: the item name followed by its options.
create or replace function public._biz_line_label(l jsonb)
returns text language sql immutable as $$
  select (l->>'name') || coalesce(' (' || nullif((select string_agg(o, ', ') from jsonb_array_elements_text(coalesce(l->'opts', '[]')) o), '') || ')', '');
$$;

create or replace function public.biz_send_to_kitchen(p_shop uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; sent jsonb; diff jsonb; n int; tk biz_tickets;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' then raise exception 'ORDER_CLOSED'; end if;
  sent := _biz_sent(p_order);
  -- now (per key) minus already sent
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'name', name, 'note', note, 'qty', q - coalesce((sent->>k)::numeric, 0))
           order by first) filter (where q - coalesce((sent->>k)::numeric, 0) <> 0), '[]')
  into diff from (
    select _biz_line_key(l) k, min(_biz_line_label(l)) name, min(l->>'note') note, sum((l->>'qty')::numeric) q, min(ord) first
    from jsonb_array_elements(o.lines) with ordinality as x(l, ord) group by 1) cur;
  -- items sent before and now gone completely (name and note from the earlier ticket)
  select diff || coalesce(jsonb_agg(jsonb_build_object('key', e.k,
           'name', (select tl->>'name' from biz_tickets t, jsonb_array_elements(t.lines) tl where t.order_id = p_order and tl->>'key' = e.k limit 1),
           'note', nullif(split_part(e.k, '|', 2), ''), 'qty', -(e.v::numeric))), '[]')
  into diff from jsonb_each_text(sent) e(k, v)
  where not exists (select 1 from jsonb_array_elements(o.lines) l where _biz_line_key(l) = e.k);
  if jsonb_array_length(diff) = 0 then return null; end if;

  perform pg_advisory_xact_lock(hashtext('biz_ticket_' || p_shop::text));
  select coalesce(max(no), 0) + 1 into n from biz_tickets
  where shop_id = p_shop and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
  insert into biz_tickets (shop_id, order_id, no, lines) values (p_shop, p_order, n, diff) returning * into tk;
  return jsonb_build_object('id', tk.id, 'no', tk.no, 'lines', tk.lines);
end $$;

revoke execute on function public._biz_clean_options(jsonb), public._biz_line_label(jsonb) from public, anon, authenticated;
