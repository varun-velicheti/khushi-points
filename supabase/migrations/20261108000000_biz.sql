-- Khushi Biz: restaurant & café POS on the same shops, staff and points.
-- Step 1: menu, tables, orders, GST bill, payment, points.
--
-- Design:
-- * One order = one row. Its items live in `lines` (jsonb), so a whole order saves in one call.
-- * Order ids are made on the device, so saving or paying twice is harmless (needed for offline sync).
-- * Totals are always worked out here (_biz_totals); the device shows the same sums but the database decides.
-- * Paying an order gives Khushi Points through add_bill, the same path as the counter screen.

alter table public.shops
  add column gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  add column legal_name text check (char_length(legal_name) <= 100),
  add column gst_inclusive boolean not null default true,
  add column upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9]{2,64}$');

create table public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.menu_categories (shop_id);

create table public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  price       numeric(10,2) not null check (price >= 0),
  gst_rate    numeric(4,2) not null default 5 check (gst_rate in (0, 5, 12, 18, 28)),
  hsn         text check (hsn ~ '^[0-9]{4,8}$'),
  veg         boolean not null default true,
  available   boolean not null default true,
  sort        int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.menu_items (shop_id) where archived_at is null;

create table public.dining_tables (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 20),
  sort        int not null default 0,
  archived_at timestamptz
);
create index on public.dining_tables (shop_id) where archived_at is null;

create table public.biz_orders (
  id                uuid primary key,
  shop_id           uuid not null references public.shops(id) on delete cascade,
  kind              text not null default 'dine_in' check (kind in ('dine_in', 'takeaway')),
  table_id          uuid references public.dining_tables(id) on delete set null,
  status            text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  lines             jsonb not null default '[]',
  customer_mobile   text,
  customer_member   text,
  customer_name     text,
  redeem_request_id uuid unique references public.redeem_requests(id) on delete set null,
  opened_by         uuid references auth.users(id) on delete set null,
  opened_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- filled when paid
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id) on delete set null,
  invoice_no        text,
  totals            jsonb,
  payments          jsonb,
  points_txn_id     bigint references public.transactions(id) on delete set null,
  points_earned     int,
  points_error      text,
  unique (shop_id, invoice_no)
);
create index on public.biz_orders (shop_id, status);
create index on public.biz_orders (shop_id, paid_at desc);
create unique index biz_one_open_order_per_table on public.biz_orders (table_id) where status = 'open' and table_id is not null;

-- Invoice numbers run in order per shop, financial year and series (one series per device later).
create table public.biz_invoice_counters (
  shop_id uuid not null references public.shops(id) on delete cascade,
  fy      text not null,
  series  text not null,
  last    int not null default 0,
  primary key (shop_id, fy, series)
);

alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.dining_tables enable row level security;
alter table public.biz_orders enable row level security;
alter table public.biz_invoice_counters enable row level security;

-- ---------------------------------------------------------------- money

-- Bill totals from order lines. `discount` is rupees off the bill (points used).
-- Line totals include GST (prices with GST added on when the shop's prices exclude it).
-- A discount lowers every line by the same share, so GST is charged on what is actually paid.
-- The total is rounded to the rupee; the difference is shown as "round off".
create or replace function public._biz_totals(p_lines jsonb, p_inclusive boolean, p_discount numeric default 0)
returns jsonb language plpgsql immutable as $$
declare
  gross numeric := 0; factor numeric; taxable numeric := 0; tax numeric := 0; cgst numeric; total numeric;
  by_rate jsonb := '[]'; rec record;
begin
  select coalesce(sum(case when p_inclusive then (l->>'price')::numeric * (l->>'qty')::numeric
                           else (l->>'price')::numeric * (l->>'qty')::numeric * (1 + (l->>'gst_rate')::numeric / 100) end), 0)
  into gross from jsonb_array_elements(p_lines) l;
  p_discount := least(greatest(coalesce(p_discount, 0), 0), gross);
  factor := case when gross > 0 then (gross - p_discount) / gross else 0 end;
  for rec in
    select (l->>'gst_rate')::numeric rate,
           sum(case when p_inclusive then (l->>'price')::numeric * (l->>'qty')::numeric
                    else (l->>'price')::numeric * (l->>'qty')::numeric * (1 + (l->>'gst_rate')::numeric / 100) end) * factor amount
    from jsonb_array_elements(p_lines) l group by 1 order by 1
  loop
    taxable := taxable + round(rec.amount / (1 + rec.rate / 100), 2);
    tax := tax + (round(rec.amount, 2) - round(rec.amount / (1 + rec.rate / 100), 2));
    by_rate := by_rate || jsonb_build_object('rate', rec.rate, 'taxable', round(rec.amount / (1 + rec.rate / 100), 2),
      'tax', round(rec.amount, 2) - round(rec.amount / (1 + rec.rate / 100), 2));
  end loop;
  cgst := round(tax / 2, 2);
  total := round(taxable + tax);
  return jsonb_build_object('items', round(gross, 2), 'discount', round(p_discount, 2), 'taxable', taxable,
    'cgst', cgst, 'sgst', tax - cgst, 'round_off', total - (taxable + tax), 'total', total, 'by_rate', by_rate);
end $$;

-- Lines must be well formed; the device copies name, price and GST from the menu when the item is added.
create or replace function public._biz_clean_lines(p_lines jsonb)
returns jsonb language plpgsql immutable as $$
declare l jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]')) > 200 then raise exception 'BAD_LINES'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    if coalesce(l->>'name', '') = '' or char_length(l->>'name') > 60
       or l->>'price' is null or l->>'qty' is null or l->>'gst_rate' is null
       or (l->>'price')::numeric < 0 or (l->>'qty')::numeric <= 0 or (l->>'qty')::numeric > 999
       or (l->>'gst_rate')::numeric not in (0, 5, 12, 18, 28) then
      raise exception 'BAD_LINES';
    end if;
    out := out || jsonb_build_object('item_id', l->'item_id', 'name', l->>'name', 'price', (l->>'price')::numeric,
      'qty', (l->>'qty')::numeric, 'gst_rate', (l->>'gst_rate')::numeric, 'hsn', l->>'hsn',
      'note', nullif(left(coalesce(l->>'note', ''), 100), ''));
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- menu & settings

-- Everything a POS device needs to start, in one call (and to keep for offline use later).
create or replace function public.biz_menu(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'legal_name', s.legal_name, 'gstin', s.gstin, 'address', s.address,
      'contact_phone', s.contact_phone, 'gst_inclusive', s.gst_inclusive, 'upi_id', s.upi_id,
      'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct, 'logo_path', s.logo_path),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from menu_categories where shop_id = p_shop), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'price', price,
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'));
end $$;

create or replace function public.biz_save_settings(p_shop uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update shops set
    gstin         = case when p ? 'gstin' then nullif(upper(trim(p->>'gstin')), '') else gstin end,
    legal_name    = case when p ? 'legal_name' then nullif(trim(p->>'legal_name'), '') else legal_name end,
    gst_inclusive = coalesce((p->>'gst_inclusive')::boolean, gst_inclusive),
    upi_id        = case when p ? 'upi_id' then nullif(trim(p->>'upi_id'), '') else upi_id end
  where id = p_shop;
end $$;

create or replace function public.biz_save_category(p_shop uuid, p_id uuid, p_name text, p_sort int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform _require_member(p_shop, true);
  insert into menu_categories (id, shop_id, name, sort) values (coalesce(p_id, gen_random_uuid()), p_shop, trim(p_name), coalesce(p_sort, 0))
  on conflict (id) do update set name = excluded.name, sort = excluded.sort where menu_categories.shop_id = p_shop
  returning id into cid;
  if cid is null then raise exception 'NOT_FOUND'; end if;
  return cid;
end $$;

create or replace function public.biz_delete_category(p_shop uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  delete from menu_categories where id = p_id and shop_id = p_shop;
end $$;

create or replace function public.biz_save_item(p_shop uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare iid uuid; cat uuid := nullif(p->>'category_id', '')::uuid;
begin
  perform _require_member(p_shop, true);
  if cat is not null and not exists (select 1 from menu_categories where id = cat and shop_id = p_shop) then raise exception 'NOT_FOUND'; end if;
  insert into menu_items (id, shop_id, category_id, name, price, gst_rate, hsn, veg, available, sort)
  values (coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), p_shop, cat, trim(p->>'name'), (p->>'price')::numeric,
    coalesce((p->>'gst_rate')::numeric, 5), nullif(trim(coalesce(p->>'hsn', '')), ''), coalesce((p->>'veg')::boolean, true),
    coalesce((p->>'available')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, price = excluded.price,
    gst_rate = excluded.gst_rate, hsn = excluded.hsn, veg = excluded.veg, available = excluded.available, sort = excluded.sort
    where menu_items.shop_id = p_shop and menu_items.archived_at is null
  returning id into iid;
  if iid is null then raise exception 'NOT_FOUND'; end if;
  return iid;
end $$;

create or replace function public.biz_archive_item(p_shop uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update menu_items set archived_at = now() where id = p_id and shop_id = p_shop;
end $$;

-- Cashiers can mark an item sold out (or back) during service.
create or replace function public.biz_set_available(p_shop uuid, p_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  update menu_items set available = p_available where id = p_id and shop_id = p_shop and archived_at is null;
end $$;

create or replace function public.biz_save_table(p_shop uuid, p_id uuid, p_name text, p_sort int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  perform _require_member(p_shop, true);
  insert into dining_tables (id, shop_id, name, sort) values (coalesce(p_id, gen_random_uuid()), p_shop, trim(p_name), coalesce(p_sort, 0))
  on conflict (id) do update set name = excluded.name, sort = excluded.sort
    where dining_tables.shop_id = p_shop and dining_tables.archived_at is null
  returning id into tid;
  if tid is null then raise exception 'NOT_FOUND'; end if;
  return tid;
end $$;

create or replace function public.biz_archive_table(p_shop uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update dining_tables set archived_at = now() where id = p_id and shop_id = p_shop;
end $$;

-- ---------------------------------------------------------------- orders

create or replace function public._biz_order_json(o biz_orders)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'kind', o.kind, 'table_id', o.table_id, 'status', o.status, 'lines', o.lines,
    'customer_mobile', o.customer_mobile, 'customer_member', o.customer_member, 'customer_name', o.customer_name,
    'redeem_request_id', o.redeem_request_id, 'opened_at', o.opened_at, 'updated_at', o.updated_at,
    'paid_at', o.paid_at, 'invoice_no', o.invoice_no, 'totals', o.totals, 'payments', o.payments,
    'points_earned', o.points_earned, 'points_error', o.points_error);
$$;

create or replace function public.biz_open_orders(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  return coalesce((select jsonb_agg(_biz_order_json(o) || jsonb_build_object('total', (_biz_totals(o.lines, s.gst_inclusive))->'total')
    order by o.opened_at) from biz_orders o where o.shop_id = p_shop and o.status = 'open'), '[]');
end $$;

-- Create or update an open order. Safe to call again with the same content.
create or replace function public.biz_save_order(p_shop uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; oid uuid := (p->>'id')::uuid; tbl uuid := nullif(p->>'table_id', '')::uuid;
begin
  perform _require_member(p_shop);
  if oid is null then raise exception 'BAD_ORDER'; end if;
  select * into o from biz_orders where id = oid for update;
  if found and o.shop_id <> p_shop then raise exception 'NOT_FOUND'; end if;
  if found and o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if tbl is not null and not exists (select 1 from dining_tables where id = tbl and shop_id = p_shop and archived_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  begin
    insert into biz_orders (id, shop_id, kind, table_id, lines, customer_mobile, customer_member, customer_name, opened_by)
    values (oid, p_shop, coalesce(p->>'kind', 'dine_in'), tbl, _biz_clean_lines(p->'lines'),
      case when nullif(trim(coalesce(p->>'customer_mobile', '')), '') is not null then _clean_mobile(p->>'customer_mobile') end,
      nullif(trim(coalesce(p->>'customer_member', '')), ''),
      nullif(trim(coalesce(p->>'customer_name', '')), ''), auth.uid())
    on conflict (id) do update set kind = excluded.kind, table_id = excluded.table_id, lines = excluded.lines,
      customer_mobile = excluded.customer_mobile, customer_member = excluded.customer_member,
      customer_name = excluded.customer_name, updated_at = now()
    returning * into o;
  exception when unique_violation then
    raise exception 'TABLE_BUSY';
  end;
  return _biz_order_json(o);
end $$;

-- Points used on this order: the customer approved a redemption in their app (start_redemption flow).
create or replace function public.biz_use_redemption(p_shop uuid, p_order uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; r redeem_requests;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if p_request is not null then
    select * into r from redeem_requests where id = p_request and shop_id = p_shop;
    if not found or r.status <> 'done' then raise exception 'REDEEM_NOT_APPROVED'; end if;
  end if;
  update biz_orders set redeem_request_id = p_request, updated_at = now() where id = p_order returning * into o;
  return _biz_order_json(o);
end $$;

create or replace function public.biz_cancel_order(p_shop uuid, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  update biz_orders set status = 'cancelled', updated_at = now() where id = p_order and shop_id = p_shop and status = 'open';
end $$;

-- Bill preview: totals as the invoice will show them.
create or replace function public.biz_preview(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders; s shops; disc numeric := 0;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'paid' then return o.totals; end if;
  select r.points * s.point_value into disc from redeem_requests r where r.id = o.redeem_request_id and r.status = 'done';
  return _biz_totals(o.lines, s.gst_inclusive, coalesce(disc, 0));
end $$;

-- Pay an order: totals, invoice number, payment, then Khushi Points for the customer.
-- Paying again returns the same invoice. Points problems never stop the payment; they are reported.
create or replace function public.biz_pay_order(p_shop uuid, p_order uuid, p_mode text, p_series text default 'A',
                                               p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; t jsonb; disc numeric := 0; v_fy text; seq int; inv text; d date; earn jsonb; items text;
begin
  perform _require_member(p_shop);
  if p_mode not in ('cash', 'upi', 'card') then raise exception 'BAD_PAYMENT'; end if;
  if coalesce(p_series, '') !~ '^[A-Z]{1,2}$' then raise exception 'BAD_SERIES'; end if;
  select * into s from shops where id = p_shop;
  select * into o from biz_orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'paid' then return _biz_order_json(o); end if;
  if o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  if jsonb_array_length(o.lines) = 0 then raise exception 'EMPTY_ORDER'; end if;

  select r.points * s.point_value into disc from redeem_requests r where r.id = o.redeem_request_id and r.status = 'done';
  t := _biz_totals(o.lines, s.gst_inclusive, coalesce(disc, 0));

  d := (now() at time zone s.timezone)::date;
  v_fy := case when extract(month from d) >= 4 then to_char(d, 'YY') || to_char(d + interval '1 year', 'YY')
             else to_char(d - interval '1 year', 'YY') || to_char(d, 'YY') end;
  insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, 1)
  on conflict (shop_id, fy, series) do update set last = biz_invoice_counters.last + 1
  returning last into seq;
  inv := p_series || v_fy || '-' || lpad(seq::text, 4, '0');

  update biz_orders set status = 'paid', paid_at = now(), paid_by = auth.uid(), invoice_no = inv, totals = t,
    payments = jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', t->'total')), updated_at = now()
  where id = p_order returning * into o;

  -- Khushi Points for the customer, if one was added to the order
  if (o.customer_mobile is not null or o.customer_member is not null) and (t->>'total')::numeric > 0 then
    select string_agg(trim(to_char((l->>'qty')::numeric, 'FM999990.##')) || ' ' || (l->>'name'), ', ')
    into items from jsonb_array_elements(o.lines) l;
    begin
      earn := add_bill(p_shop, o.customer_mobile, inv, (t->>'total')::numeric, o.customer_name, p_consent, o.customer_member, left(items, 300));
      update biz_orders set points_txn_id = (earn->>'txn_id')::bigint, points_earned = (earn->>'points')::int
      where id = p_order returning * into o;
    exception when others then
      update biz_orders set points_error = sqlerrm where id = p_order returning * into o;
    end;
  end if;
  return _biz_order_json(o) || jsonb_build_object('txn_id', o.points_txn_id);
end $$;

-- Full invoice for screen or print.
create or replace function public.biz_invoice(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  return _biz_order_json(o) || jsonb_build_object('table', (select name from dining_tables where id = o.table_id));
end $$;

revoke execute on function public._biz_totals(jsonb, boolean, numeric), public._biz_clean_lines(jsonb),
  public._biz_order_json(biz_orders) from public, anon, authenticated;
revoke execute on function public.biz_menu(uuid), public.biz_save_settings(uuid, jsonb), public.biz_save_category(uuid, uuid, text, int),
  public.biz_delete_category(uuid, uuid), public.biz_save_item(uuid, jsonb), public.biz_archive_item(uuid, uuid),
  public.biz_set_available(uuid, uuid, boolean), public.biz_save_table(uuid, uuid, text, int), public.biz_archive_table(uuid, uuid),
  public.biz_open_orders(uuid), public.biz_save_order(uuid, jsonb), public.biz_use_redemption(uuid, uuid, uuid),
  public.biz_cancel_order(uuid, uuid), public.biz_preview(uuid, uuid), public.biz_pay_order(uuid, uuid, text, text, boolean),
  public.biz_invoice(uuid, uuid) from public, anon;
grant execute on function public.biz_menu(uuid), public.biz_save_settings(uuid, jsonb), public.biz_save_category(uuid, uuid, text, int),
  public.biz_delete_category(uuid, uuid), public.biz_save_item(uuid, jsonb), public.biz_archive_item(uuid, uuid),
  public.biz_set_available(uuid, uuid, boolean), public.biz_save_table(uuid, uuid, text, int), public.biz_archive_table(uuid, uuid),
  public.biz_open_orders(uuid), public.biz_save_order(uuid, jsonb), public.biz_use_redemption(uuid, uuid, uuid),
  public.biz_cancel_order(uuid, uuid), public.biz_preview(uuid, uuid), public.biz_pay_order(uuid, uuid, text, text, boolean),
  public.biz_invoice(uuid, uuid) to authenticated;
