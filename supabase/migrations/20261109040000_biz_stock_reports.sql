-- Khushi Biz step 4: stock per menu item (for the items you choose) and reports.
-- Stock goes down when a bill is paid (also bills paid offline, when they arrive). Every change is logged.

alter table public.menu_items
  add column track_stock boolean not null default false,
  add column stock numeric(10,2) not null default 0,
  add column low_stock numeric(10,2) not null default 5 check (low_stock >= 0);

create table public.biz_stock_moves (
  id       bigint generated always as identity primary key,
  shop_id  uuid not null references public.shops(id) on delete cascade,
  item_id  uuid not null references public.menu_items(id) on delete cascade,
  change   numeric(10,2) not null,
  reason   text not null check (reason in ('sale', 'add', 'count')),
  order_id uuid references public.biz_orders(id) on delete set null,
  by_user  uuid references auth.users(id) on delete set null,
  at       timestamptz not null default now()
);
create index on public.biz_stock_moves (shop_id, at desc);
alter table public.biz_stock_moves enable row level security;

-- When an order becomes paid, take its items out of stock.
create or replace function public._biz_stock_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    for r in
      select i.id, sum((l->>'qty')::numeric) qty
      from jsonb_array_elements(new.lines) l join menu_items i on i.id::text = l->>'item_id'
      where i.shop_id = new.shop_id and i.track_stock group by i.id
    loop
      update menu_items set stock = stock - r.qty where id = r.id;
      insert into biz_stock_moves (shop_id, item_id, change, reason, order_id, by_user) values (new.shop_id, r.id, -r.qty, 'sale', new.id, auth.uid());
    end loop;
  end if;
  return new;
end $$;
create trigger biz_stock_on_paid after update of status on public.biz_orders for each row execute function public._biz_stock_on_paid();

-- Owner: count stock for this item or not.
create or replace function public.biz_stock_track(p_shop uuid, p_item uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update menu_items set track_stock = p_on where id = p_item and shop_id = p_shop and archived_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Staff: a delivery came in (or some went to waste, with a negative number).
create or replace function public.biz_stock_add(p_shop uuid, p_item uuid, p_qty numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare left_now numeric;
begin
  perform _require_member(p_shop);
  if p_qty is null or p_qty = 0 or abs(p_qty) > 100000 then raise exception 'BAD_QTY'; end if;
  update menu_items set stock = stock + p_qty where id = p_item and shop_id = p_shop and track_stock and archived_at is null
  returning stock into left_now;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into biz_stock_moves (shop_id, item_id, change, reason, by_user) values (p_shop, p_item, p_qty, 'add', auth.uid());
  return left_now;
end $$;

-- Owner: after counting the shelf, set the real number.
create or replace function public.biz_stock_count(p_shop uuid, p_item uuid, p_count numeric)
returns void language plpgsql security definer set search_path = public as $$
declare was numeric;
begin
  perform _require_member(p_shop, true);
  if p_count is null or p_count < 0 or p_count > 1000000 then raise exception 'BAD_QTY'; end if;
  select stock into was from menu_items where id = p_item and shop_id = p_shop and track_stock and archived_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_count = was then return; end if;
  update menu_items set stock = p_count where id = p_item;
  insert into biz_stock_moves (shop_id, item_id, change, reason, by_user) values (p_shop, p_item, p_count - was, 'count', auth.uid());
end $$;

-- Stock page: every item with its count, plus the latest changes.
create or replace function public.biz_stock(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'track_stock', track_stock, 'stock', stock,
        'low_stock', low_stock) order by track_stock desc, (track_stock and stock <= low_stock) desc, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'change', m.change, 'reason', m.reason, 'at', m.at,
        'by', (select email from auth.users where id = m.by_user)) order by m.at desc)
      from (select * from biz_stock_moves where shop_id = p_shop order by at desc limit 30) m join menu_items i on i.id = m.item_id), '[]'));
end $$;

-- The menu now carries stock counts so the order screen can show "3 left".
create or replace function public.biz_menu(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'legal_name', s.legal_name, 'gstin', s.gstin, 'address', s.address,
      'contact_phone', s.contact_phone, 'gst_inclusive', s.gst_inclusive, 'upi_id', s.upi_id,
      'point_value', s.point_value, 'min_redeem', s.min_redeem, 'max_redeem_pct', s.max_redeem_pct, 'logo_path', s.logo_path, 'kitchen', s.biz_kitchen, 'timezone', s.timezone),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from menu_categories where shop_id = p_shop), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'price', price,
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort,
        'track_stock', track_stock, 'stock', stock, 'low_stock', low_stock) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'));
end $$;

-- Reports for a date range (shop's own days): sales, payments, GST, items, and every invoice for the accountant.
create or replace function public.biz_report(p_shop uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'BAD_RANGE'; end if;
  select * into s from shops where id = p_shop;
  return (
    with b as (
      select o.*, (o.paid_at at time zone s.timezone)::date as day from biz_orders o
      where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to)
    select jsonb_build_object(
      'bills', (select count(*) from b),
      'sales', (select coalesce(sum((totals->>'total')::numeric), 0) from b),
      'taxable', (select coalesce(sum((totals->>'taxable')::numeric), 0) from b),
      'gst', (select coalesce(sum((totals->>'cgst')::numeric + (totals->>'sgst')::numeric), 0) from b),
      'discount', (select coalesce(sum((totals->>'discount')::numeric), 0) from b),
      'by_mode', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'bills', n, 'amount', amt) order by amt desc) from (
          select payments->0->>'mode' mode, count(*) n, sum((totals->>'total')::numeric) amt from b group by 1) x), '[]'),
      'by_rate', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', tx, 'cgst', round(tax / 2, 2), 'sgst', tax - round(tax / 2, 2)) order by rate) from (
          select (r->>'rate')::numeric rate, sum((r->>'taxable')::numeric) tx, sum((r->>'tax')::numeric) tax
          from b, jsonb_array_elements(b.totals->'by_rate') r group by 1) x), '[]'),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'bills', n, 'sales', amt) order by day) from (
          select day, count(*) n, sum((totals->>'total')::numeric) amt from b group by 1) x), '[]'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'amount', amt) order by amt desc) from (
          select l->>'name' name, sum((l->>'qty')::numeric) q, sum((l->>'price')::numeric * (l->>'qty')::numeric) amt
          from b, jsonb_array_elements(b.lines) l group by 1 limit 200) x), '[]'),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_no', invoice_no, 'paid_at', paid_at, 'mode', payments->0->>'mode',
          'taxable', totals->'taxable', 'cgst', totals->'cgst', 'sgst', totals->'sgst', 'discount', totals->'discount',
          'round_off', totals->'round_off', 'total', totals->'total') order by paid_at)
        from (select * from b order by paid_at limit 5000) x), '[]')));
end $$;

revoke execute on function public._biz_stock_on_paid() from public, anon, authenticated;
revoke execute on function public.biz_stock_track(uuid, uuid, boolean), public.biz_stock_add(uuid, uuid, numeric),
  public.biz_stock_count(uuid, uuid, numeric), public.biz_stock(uuid), public.biz_report(uuid, date, date) from public, anon;
grant execute on function public.biz_stock_track(uuid, uuid, boolean), public.biz_stock_add(uuid, uuid, numeric),
  public.biz_stock_count(uuid, uuid, numeric), public.biz_stock(uuid), public.biz_report(uuid, date, date) to authenticated;
