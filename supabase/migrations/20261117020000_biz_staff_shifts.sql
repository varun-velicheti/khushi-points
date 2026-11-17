-- POS: staff PINs (cashier / manager) and cash shifts.
-- On a shared counter device, staff say who they are with a PIN. Voids, refunds and reports need a manager:
-- the owner's own login, or a manager PIN, which gives a 10-minute approval token (the PIN never leaves the server).
-- Each bill remembers who took it. A cash shift opens with a float and closes with the counted cash;
-- expected cash = float + cash taken on bills - cash refunds, in the shift's time.

create table public.biz_staff (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  role       text not null check (role in ('cashier', 'manager')),
  pin_hash   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.biz_staff (shop_id) where active;

create table public.biz_pin_fails (shop_id uuid not null references public.shops(id) on delete cascade, at timestamptz not null default now());
create index on public.biz_pin_fails (shop_id, at);

create table public.biz_approvals (
  token      uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  staff_id   uuid not null references public.biz_staff(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);

alter table public.biz_orders add column staff_id uuid references public.biz_staff(id) on delete set null;

create table public.biz_shifts (
  id         uuid primary key,                                   -- made on the device: opening twice does no harm
  shop_id    uuid not null references public.shops(id) on delete cascade,
  opened_at  timestamptz not null default now(),
  opened_by  uuid references public.biz_staff(id) on delete set null,
  float      numeric(10,2) not null check (float >= 0),
  closed_at  timestamptz,
  closed_by  uuid references public.biz_staff(id) on delete set null,
  counted    numeric(10,2) check (counted >= 0),
  expected   numeric(10,2),
  note       text check (char_length(note) <= 120)
);
create unique index biz_shifts_one_open on public.biz_shifts (shop_id) where closed_at is null;

alter table public.biz_staff enable row level security;
alter table public.biz_pin_fails enable row level security;
alter table public.biz_approvals enable row level security;
alter table public.biz_shifts enable row level security;

-- ---------------------------------------------------------------- staff

create or replace function public._biz_pin_staff(p_shop uuid, p_pin text)
returns biz_staff language plpgsql stable security definer set search_path = public, extensions as $$
declare s biz_staff;
begin
  for s in select * from biz_staff where shop_id = p_shop and active loop
    if crypt(coalesce(p_pin, ''), s.pin_hash) = s.pin_hash then return s; end if;
  end loop;
  return null;
end $$;

create or replace function public.biz_staff_list(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by role desc, name)
    from biz_staff where shop_id = p_shop and active), '[]');
end $$;

-- p: {id?, name, role, pin?}; a new person needs a PIN; PINs are unique in the shop.
create or replace function public.biz_staff_save(p_shop uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid := nullif(p->>'id', '')::uuid; pin text := nullif(p->>'pin', ''); other biz_staff;
begin
  perform _require_member(p_shop, true);
  if char_length(trim(coalesce(p->>'name', ''))) not between 1 and 40 then raise exception 'BAD_NAME'; end if;
  if coalesce(p->>'role', '') not in ('cashier', 'manager') then raise exception 'BAD_ROLE'; end if;
  if pin is not null and pin !~ '^[0-9]{4,6}$' then raise exception 'BAD_PIN'; end if;
  if sid is null and pin is null then raise exception 'BAD_PIN'; end if;
  if pin is not null then
    other := _biz_pin_staff(p_shop, pin);
    if other.id is not null and other.id is distinct from sid then raise exception 'PIN_TAKEN'; end if;
  end if;
  if sid is null then
    insert into biz_staff (shop_id, name, role, pin_hash) values (p_shop, trim(p->>'name'), p->>'role', crypt(pin, gen_salt('bf', 6)))
    returning id into sid;
  else
    update biz_staff set name = trim(p->>'name'), role = p->>'role', pin_hash = case when pin is null then pin_hash else crypt(pin, gen_salt('bf', 6)) end
    where id = sid and shop_id = p_shop and active returning id into sid;
    if sid is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return sid;
end $$;

create or replace function public.biz_staff_remove(p_shop uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop, true);
  update biz_staff set active = false where id = p_id and shop_id = p_shop;
  delete from biz_approvals where staff_id = p_id;
end $$;

-- Who is this? Wrong PINs return ok=false (not an exception) so they are counted; 8 wrong in 10 minutes locks PIN entry.
-- A manager also gets an approval token for voids, refunds and reports.
create or replace function public.biz_staff_check(p_shop uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s biz_staff; tok uuid;
begin
  perform _require_member(p_shop);
  if (select count(*) from biz_pin_fails where shop_id = p_shop and at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_TRIES');
  end if;
  s := _biz_pin_staff(p_shop, p_pin);
  if s.id is null then
    insert into biz_pin_fails (shop_id) values (p_shop);
    return jsonb_build_object('ok', false, 'error', 'WRONG_PIN');
  end if;
  delete from biz_approvals where expires_at < now();
  if s.role = 'manager' then insert into biz_approvals (shop_id, staff_id) values (p_shop, s.id) returning token into tok; end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'name', s.name, 'role', s.role, 'approval', tok);
end $$;

-- Owner-only checks also pass inside a call that a manager approved (set for this transaction only).
create or replace function public._require_member(p_shop uuid, p_owner_only boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_owner_only and current_setting('kushly.manager', true) = p_shop::text and is_member(p_shop, false) then return; end if;
  if not is_member(p_shop, p_owner_only) then
    raise exception '%', case when p_owner_only then 'OWNER_ONLY' else 'NOT_A_MEMBER' end;
  end if;
end $$;

create or replace function public._biz_as_manager(p_shop uuid, p_approval uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  if is_member(p_shop, true) then return; end if;
  if p_approval is null or not exists (select 1 from biz_approvals a join biz_staff s on s.id = a.staff_id
      where a.token = p_approval and a.shop_id = p_shop and a.expires_at > now() and s.active and s.role = 'manager') then
    raise exception 'MANAGER_ONLY';
  end if;
  perform set_config('kushly.manager', p_shop::text, true);
end $$;

-- Voids, refunds and reports: same work as before, now also with a manager's approval.
alter function public.biz_void_order(uuid, uuid, text) rename to _biz_void_order;
alter function public.biz_refund_order(uuid, uuid, uuid, jsonb, text, text) rename to _biz_refund_order;
alter function public.biz_report(uuid, date, date) rename to _biz_report;
revoke execute on function public._biz_void_order(uuid, uuid, text), public._biz_refund_order(uuid, uuid, uuid, jsonb, text, text),
  public._biz_report(uuid, date, date) from public, anon, authenticated;

create function public.biz_void_order(p_shop uuid, p_order uuid, p_reason text default null, p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _biz_as_manager(p_shop, p_approval);
  return _biz_void_order(p_shop, p_order, p_reason);
end $$;

create function public.biz_refund_order(p_shop uuid, p_order uuid, p_id uuid, p_lines jsonb, p_mode text, p_reason text default null,
                                        p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _biz_as_manager(p_shop, p_approval);
  return _biz_refund_order(p_shop, p_order, p_id, p_lines, p_mode, p_reason);
end $$;

-- Reports also show sales by who took the bill.
create function public.biz_report(p_shop uuid, p_from date, p_to date, p_approval uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  perform _biz_as_manager(p_shop, p_approval);
  select * into s from shops where id = p_shop;
  return _biz_report(p_shop, p_from, p_to) || jsonb_build_object('by_staff', coalesce((
    select jsonb_agg(jsonb_build_object('name', coalesce(st.name, 'Not set'), 'bills', n, 'sales', amt) order by amt desc) from (
      select o.staff_id, count(*) n, sum((o.totals->>'total')::numeric) amt from biz_orders o
      where o.shop_id = p_shop and o.status = 'paid' and (o.paid_at at time zone s.timezone)::date between p_from and p_to
      group by 1) x left join biz_staff st on st.id = x.staff_id), '[]'));
end $$;

-- ---------------------------------------------------------------- orders remember who took them

create or replace function public.biz_save_order(p_shop uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o biz_orders; oid uuid := (p->>'id')::uuid; tbl uuid := nullif(p->>'table_id', '')::uuid; who uuid;
begin
  perform _require_member(p_shop);
  if oid is null then raise exception 'BAD_ORDER'; end if;
  select * into o from biz_orders where id = oid for update;
  if found and o.shop_id <> p_shop then raise exception 'NOT_FOUND'; end if;
  if found and o.status <> 'open' then raise exception 'ORDER_CLOSED'; end if;
  -- a different customer: the points request belongs to the old one, so undo it
  if found and o.redeem_request_id is not null
     and (o.customer_mobile is distinct from case when nullif(trim(coalesce(p->>'customer_mobile', '')), '') is not null then _clean_mobile(p->>'customer_mobile') end
          or o.customer_member is distinct from nullif(trim(coalesce(p->>'customer_member', '')), '')) then
    perform _biz_release_redemption(oid);
  end if;
  if tbl is not null and not exists (select 1 from dining_tables where id = tbl and shop_id = p_shop and archived_at is null) then
    raise exception 'NOT_FOUND';
  end if;
  -- staff from the device; one removed meanwhile (offline) is simply not set
  select id into who from biz_staff where id = nullif(p->>'staff_id', '')::uuid and shop_id = p_shop;
  begin
    insert into biz_orders (id, shop_id, kind, table_id, lines, customer_mobile, customer_member, customer_name, opened_by, staff_id)
    values (oid, p_shop, coalesce(p->>'kind', 'dine_in'), tbl, _biz_clean_lines(p->'lines'),
      case when nullif(trim(coalesce(p->>'customer_mobile', '')), '') is not null then _clean_mobile(p->>'customer_mobile') end,
      nullif(trim(coalesce(p->>'customer_member', '')), ''),
      nullif(trim(coalesce(p->>'customer_name', '')), ''), auth.uid(), who)
    on conflict (id) do update set kind = excluded.kind, table_id = excluded.table_id, lines = excluded.lines,
      customer_mobile = excluded.customer_mobile, customer_member = excluded.customer_member,
      customer_name = excluded.customer_name, staff_id = coalesce(biz_orders.staff_id, excluded.staff_id), updated_at = now()
    returning * into o;
  exception when unique_violation then
    raise exception 'TABLE_BUSY';
  end;
  return _biz_order_json(o);
end $$;

create or replace function public.biz_invoice(p_shop uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o biz_orders;
begin
  perform _require_member(p_shop);
  select * into o from biz_orders where id = p_order and shop_id = p_shop;
  if not found then raise exception 'NOT_FOUND'; end if;
  return _biz_order_json(o) || jsonb_build_object('table', (select name from dining_tables where id = o.table_id),
    'voided_at', o.voided_at, 'void_reason', o.void_reason, 'staff', (select name from biz_staff where id = o.staff_id),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'no', no, 'credit_no', credit_no, 'at', at, 'lines', lines,
        'totals', totals, 'mode', mode, 'reason', reason) order by no) from biz_refunds where order_id = o.id), '[]'));
end $$;

-- The menu also lists staff (names and roles only), so the device knows to ask for a PIN.
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
      from dining_tables where shop_id = p_shop and archived_at is null), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by name)
      from biz_staff where shop_id = p_shop and active), '[]'));
end $$;

-- ---------------------------------------------------------------- cash shifts

create or replace function public._biz_shift_json(sh biz_shifts)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sales numeric; refunds numeric; upto timestamptz := coalesce(sh.closed_at, now());
begin
  select coalesce(sum((p->>'amount')::numeric), 0) into sales
  from biz_orders o, jsonb_array_elements(o.payments) p
  where o.shop_id = sh.shop_id and o.status = 'paid' and o.paid_at >= sh.opened_at and o.paid_at < upto and p->>'mode' = 'cash';
  select coalesce(sum((r.totals->>'total')::numeric), 0) into refunds
  from biz_refunds r join biz_orders o on o.id = r.order_id
  where r.shop_id = sh.shop_id and o.status = 'paid' and r.mode = 'cash' and r.at >= sh.opened_at and r.at < upto;
  return jsonb_build_object('id', sh.id, 'opened_at', sh.opened_at, 'opened_by', (select name from biz_staff where id = sh.opened_by),
    'float', sh.float, 'cash_sales', sales, 'cash_refunds', refunds,
    'expected', coalesce(sh.expected, sh.float + sales - refunds),
    'closed_at', sh.closed_at, 'closed_by', (select name from biz_staff where id = sh.closed_by),
    'counted', sh.counted, 'difference', case when sh.counted is not null then sh.counted - sh.expected end, 'note', sh.note);
end $$;

create or replace function public.biz_shifts(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return jsonb_build_object(
    'open', (select _biz_shift_json(sh) from biz_shifts sh where shop_id = p_shop and closed_at is null),
    'recent', coalesce((select jsonb_agg(_biz_shift_json(sh) order by sh.closed_at desc) from (
      select * from biz_shifts where shop_id = p_shop and closed_at is not null order by closed_at desc limit 10) sh), '[]'));
end $$;

create or replace function public.biz_shift_open(p_shop uuid, p_id uuid, p_float numeric, p_staff uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  if p_float is null or p_float < 0 or p_float > 10000000 then raise exception 'BAD_AMOUNT'; end if;
  if not exists (select 1 from biz_shifts where id = p_id and shop_id = p_shop) then
    if exists (select 1 from biz_shifts where shop_id = p_shop and closed_at is null) then raise exception 'SHIFT_OPEN'; end if;
    insert into biz_shifts (id, shop_id, opened_by, float)
    values (p_id, p_shop, (select id from biz_staff where id = p_staff and shop_id = p_shop), round(p_float, 2));
  end if;
  return biz_shifts(p_shop);
end $$;

create or replace function public.biz_shift_close(p_shop uuid, p_id uuid, p_counted numeric, p_staff uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sh biz_shifts;
begin
  perform _require_member(p_shop);
  if p_counted is null or p_counted < 0 or p_counted > 10000000 then raise exception 'BAD_AMOUNT'; end if;
  select * into sh from biz_shifts where id = p_id and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if sh.closed_at is null then
    update biz_shifts set closed_at = now(), closed_by = (select id from biz_staff where id = p_staff and shop_id = p_shop),
      counted = round(p_counted, 2), expected = (_biz_shift_json(sh)->>'expected')::numeric,
      note = nullif(left(trim(coalesce(p_note, '')), 120), '')
    where id = p_id;
  end if;
  return biz_shifts(p_shop);
end $$;

revoke execute on function public._biz_pin_staff(uuid, text), public._biz_as_manager(uuid, uuid), public._biz_shift_json(biz_shifts)
  from public, anon, authenticated;
revoke execute on function public.biz_staff_list(uuid), public.biz_staff_save(uuid, jsonb), public.biz_staff_remove(uuid, uuid),
  public.biz_staff_check(uuid, text), public.biz_void_order(uuid, uuid, text, uuid),
  public.biz_refund_order(uuid, uuid, uuid, jsonb, text, text, uuid), public.biz_report(uuid, date, date, uuid),
  public.biz_shifts(uuid), public.biz_shift_open(uuid, uuid, numeric, uuid), public.biz_shift_close(uuid, uuid, numeric, uuid, text)
  from public, anon;
grant execute on function public.biz_staff_list(uuid), public.biz_staff_save(uuid, jsonb), public.biz_staff_remove(uuid, uuid),
  public.biz_staff_check(uuid, text), public.biz_void_order(uuid, uuid, text, uuid),
  public.biz_refund_order(uuid, uuid, uuid, jsonb, text, text, uuid), public.biz_report(uuid, date, date, uuid),
  public.biz_shifts(uuid), public.biz_shift_open(uuid, uuid, numeric, uuid), public.biz_shift_close(uuid, uuid, numeric, uuid, text)
  to authenticated;
