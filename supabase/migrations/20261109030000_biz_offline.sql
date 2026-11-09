-- Khushi Biz step 3: offline billing.
-- Each device claims its own invoice series (A, B, C, ...) and numbers its invoices itself,
-- so devices that are offline at the same time never clash. A bill paid offline is sent later
-- with its number and the time it was paid.

create table public.biz_devices (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  series     text not null check (series ~ '^[A-Z]{1,2}$'),
  name       text not null default '' check (char_length(name) <= 40),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (shop_id, series)
);
alter table public.biz_devices enable row level security;

-- A device asks for its series once (or again, after its storage was cleared, with the series it remembers).
-- Returns the series and the last number used in it this financial year, so numbering continues.
create or replace function public.biz_claim_series(p_shop uuid, p_name text default '', p_series text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops; ser text; d date; v_fy text;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  perform pg_advisory_xact_lock(hashtext('biz_series_' || p_shop::text));
  if p_series is not null and exists (select 1 from biz_devices where shop_id = p_shop and series = p_series) then
    ser := p_series;
    update biz_devices set last_seen = now() where shop_id = p_shop and series = ser;
  else
    select x into ser from (
      select chr(65 + i) x, i from generate_series(0, 25) i
      union all select chr(65 + i / 26) || chr(65 + i % 26), 26 + i from generate_series(0, 675) i) letters
    where not exists (select 1 from biz_devices where shop_id = p_shop and series = letters.x)
    order by letters.i limit 1;
    insert into biz_devices (shop_id, series, name, created_by) values (p_shop, ser, left(coalesce(p_name, ''), 40), auth.uid());
  end if;
  d := (now() at time zone s.timezone)::date;
  v_fy := case when extract(month from d) >= 4 then to_char(d, 'YY') || to_char(d + interval '1 year', 'YY')
               else to_char(d - interval '1 year', 'YY') || to_char(d, 'YY') end;
  return jsonb_build_object('series', ser, 'fy', v_fy,
    'last', coalesce((select last from biz_invoice_counters where shop_id = p_shop and fy = v_fy and series = ser), 0));
end $$;

-- The menu now also gives the shop's time zone (to date offline invoices).
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
        'gst_rate', gst_rate, 'hsn', hsn, 'veg', veg, 'available', available, 'sort', sort) order by sort, name)
      from menu_items where shop_id = p_shop and archived_at is null), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort, name)
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'));
end $$;

drop function if exists public.biz_pay_order(uuid, uuid, text, text, boolean);
create function public.biz_pay_order(p_shop uuid, p_order uuid, p_mode text, p_series text default 'A',
                                    p_consent boolean default false, p_seq int default null, p_paid_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; s shops; t jsonb; disc numeric := 0; v_fy text; seq int; inv text; d date; earn jsonb; items text; v_paid timestamptz;
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
  perform _biz_settle_redemption(p_order);
  select * into o from biz_orders where id = p_order;

  select r.points * s.point_value into disc from redeem_requests r where r.id = o.redeem_request_id and r.status = 'done';
  t := _biz_totals(o.lines, s.gst_inclusive, coalesce(disc, 0));

  -- paid offline: keep the device's time (not in the future, at most 30 days back)
  v_paid := greatest(least(coalesce(p_paid_at, now()), now()), now() - interval '30 days');
  d := (v_paid at time zone s.timezone)::date;
  v_fy := case when extract(month from d) >= 4 then to_char(d, 'YY') || to_char(d + interval '1 year', 'YY')
               else to_char(d - interval '1 year', 'YY') || to_char(d, 'YY') end;
  if p_seq is not null then
    -- the device numbered this invoice in its own series (works offline)
    if p_seq < 1 or not exists (select 1 from biz_devices where shop_id = p_shop and series = p_series) then raise exception 'BAD_SERIES'; end if;
    inv := p_series || v_fy || '-' || lpad(p_seq::text, 4, '0');
    if exists (select 1 from biz_orders where shop_id = p_shop and invoice_no = inv) then raise exception 'INVOICE_TAKEN'; end if;
    insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, p_seq)
    on conflict (shop_id, fy, series) do update set last = greatest(biz_invoice_counters.last, p_seq);
  else
    insert into biz_invoice_counters (shop_id, fy, series, last) values (p_shop, v_fy, p_series, 1)
    on conflict (shop_id, fy, series) do update set last = biz_invoice_counters.last + 1
    returning last into seq;
    inv := p_series || v_fy || '-' || lpad(seq::text, 4, '0');
  end if;

  update biz_orders set status = 'paid', paid_at = v_paid, paid_by = auth.uid(), invoice_no = inv, totals = t,
    payments = jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', t->'total')), updated_at = now()
  where id = p_order returning * into o;

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

revoke execute on function public.biz_claim_series(uuid, text, text),
  public.biz_pay_order(uuid, uuid, text, text, boolean, int, timestamptz) from public, anon;
grant execute on function public.biz_claim_series(uuid, text, text),
  public.biz_pay_order(uuid, uuid, text, text, boolean, int, timestamptz) to authenticated;
