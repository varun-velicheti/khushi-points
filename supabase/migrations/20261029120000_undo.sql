-- Undo a bill or a redemption.
-- Owners can undo anything in their shop. Cashiers can undo their own entry
-- within 15 minutes (for typos at the counter). An undone bill number can be
-- entered again with the right amount.

alter table public.transactions
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id) on delete set null;

-- Link each points packet to the transaction that created it.
alter table public.point_lots add column txn_id bigint references public.transactions(id) on delete cascade;
update public.point_lots l set txn_id = t.id
from public.transactions t
where l.txn_id is null and t.customer_id = l.customer_id and t.kind = 'earn'
  and t.created_at = l.earned_at and t.points = l.points;
create index on public.point_lots (txn_id);

-- An undone bill frees its bill number.
drop index if exists public.transactions_one_earn_per_bill;
create unique index transactions_one_earn_per_bill
  on public.transactions (shop_id, upper(bill_no)) where kind = 'earn' and reversed_at is null;

-- ---------------------------------------------------------------- earning (ignores undone bills)

create or replace function public.add_bill(
  p_shop uuid, p_mobile text, p_bill_no text, p_amount numeric,
  p_name text default null, p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; c customers; m text; pts int; is_new boolean := false; bill text;
  today_pts int := 0; today_max numeric := 0; award int; v_txn bigint;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  m := _clean_mobile(p_mobile);
  bill := upper(trim(coalesce(p_bill_no, '')));
  if bill = '' then raise exception 'BILL_NO_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_amount < s.min_bill then raise exception 'BELOW_MIN_BILL'; end if;

  select * into c from customers where shop_id = p_shop and mobile = m for update;
  if not found then
    if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
    insert into customers (shop_id, mobile, name)
    values (p_shop, m, coalesce(nullif(trim(p_name), ''), 'Customer'))
    on conflict (shop_id, mobile) do nothing;
    select * into c from customers where shop_id = p_shop and mobile = m for update;
    is_new := true;
  end if;

  if exists (select 1 from transactions where shop_id = p_shop and kind = 'earn'
             and reversed_at is null and upper(bill_no) = bill) then
    raise exception 'BILL_ALREADY_USED';
  end if;

  pts := floor(p_amount * s.earn_pct / 100 / s.point_value);
  if pts < 1 then raise exception 'TOO_SMALL_FOR_POINTS'; end if;
  award := pts;

  if s.one_bill_per_day then
    select coalesce(sum(points), 0), coalesce(max(amount), 0) into today_pts, today_max
    from transactions
    where customer_id = c.id and kind = 'earn' and reversed_at is null
      and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
    if today_pts > 0 then
      if p_amount <= today_max then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
      award := pts - today_pts;
      if award < 1 then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
    end if;
  end if;

  insert into transactions (shop_id, customer_id, kind, bill_no, amount, points, staff_id)
  values (p_shop, c.id, 'earn', bill, p_amount, award, auth.uid()) returning id into v_txn;
  insert into point_lots (shop_id, customer_id, points, points_left, expires_at, txn_id)
  values (p_shop, c.id, award, award, now() + make_interval(days => s.expiry_days), v_txn);

  return jsonb_build_object('txn_id', v_txn, 'points', award, 'bill_points', pts,
    'topped_up', today_pts > 0, 'earlier_today', today_pts, 'earlier_bill', today_max,
    'balance', _balance(c.id), 'value', _balance(c.id) * s.point_value,
    'name', c.name, 'is_new', is_new);
end $$;

-- ---------------------------------------------------------------- redeeming (returns txn id)

create or replace function public._do_redeem(
  p_shop uuid, p_customer uuid, p_bill_amount numeric, p_points int, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shops; bal int; cap int; left_to_take int := p_points; l record; take int; v_txn bigint;
begin
  select * into s from shops where id = p_shop;
  if p_bill_amount is null or p_bill_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_points is null or p_points < s.min_redeem then raise exception 'BELOW_MIN_REDEEM'; end if;
  bal := _balance(p_customer);
  if p_points > bal then raise exception 'NOT_ENOUGH_POINTS'; end if;
  cap := floor(p_bill_amount * s.max_redeem_pct / 100 / s.point_value);
  if p_points > cap then raise exception 'OVER_MAX_DISCOUNT'; end if;

  for l in select id, points_left from point_lots
           where customer_id = p_customer and points_left > 0 and expires_at > now()
           order by expires_at, id for update loop
    take := least(l.points_left, left_to_take);
    update point_lots set points_left = points_left - take where id = l.id;
    left_to_take := left_to_take - take;
    exit when left_to_take = 0;
  end loop;

  insert into transactions (shop_id, customer_id, kind, amount, points, method, staff_id)
  values (p_shop, p_customer, 'redeem', p_bill_amount, p_points, p_method, auth.uid()) returning id into v_txn;

  return jsonb_build_object('ok', true, 'txn_id', v_txn, 'points', p_points,
    'discount', p_points * s.point_value,
    'pay', p_bill_amount - p_points * s.point_value,
    'balance', _balance(p_customer), 'method', p_method);
end $$;

-- ---------------------------------------------------------------- undo

create or replace function public.reverse_transaction(p_shop uuid, p_txn bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t transactions; s shops; need int; take int; l record;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  select * into t from transactions where id = p_txn and shop_id = p_shop for update;
  if not found then raise exception 'NO_TRANSACTION'; end if;
  if t.reversed_at is not null then raise exception 'ALREADY_UNDONE'; end if;
  if not is_member(p_shop, true)
     and (t.staff_id is distinct from auth.uid() or t.created_at < now() - interval '15 minutes') then
    raise exception 'UNDO_OWNER_ONLY';
  end if;
  perform 1 from customers where id = t.customer_id for update;

  if t.kind = 'earn' then
    need := t.points;
    if _balance(t.customer_id) < need then raise exception 'POINTS_ALREADY_USED'; end if;
    -- take back from this bill's own packet first, then the newest others
    for l in select id, points_left from point_lots
             where customer_id = t.customer_id and points_left > 0 and expires_at > now()
             order by (txn_id = t.id) desc nulls last, expires_at desc, id desc for update loop
      take := least(l.points_left, need);
      update point_lots set points_left = points_left - take where id = l.id;
      need := need - take;
      exit when need = 0;
    end loop;
  else
    -- give the redeemed points back as a fresh packet
    insert into point_lots (shop_id, customer_id, points, points_left, expires_at, txn_id)
    values (p_shop, t.customer_id, t.points, t.points, now() + make_interval(days => s.expiry_days), t.id);
  end if;

  update transactions set reversed_at = now(), reversed_by = auth.uid() where id = t.id;
  return jsonb_build_object('ok', true, 'kind', t.kind, 'points', t.points, 'balance', _balance(t.customer_id));
end $$;

-- ---------------------------------------------------------------- reports ignore undone entries

create or replace function public.customer_balance(p_shop uuid, p_mobile text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops; c customers; m text;
begin
  perform _require_member(p_shop);
  select * into s from shops where id = p_shop;
  m := _clean_mobile(p_mobile);
  select * into c from customers where shop_id = p_shop and mobile = m;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object(
    'exists', true, 'name', c.name, 'mobile', c.mobile,
    'balance', _balance(c.id),
    'value', _balance(c.id) * s.point_value,
    'expiring_30d', (select coalesce(sum(points_left),0) from point_lots
                     where customer_id = c.id and points_left > 0
                       and expires_at > now() and expires_at <= now() + interval '30 days'),
    'has_pin', c.pin_hash is not null,
    'pin_locked', c.pin_hash is not null and c.pin_fails >= 3,
    'recent', coalesce((select jsonb_agg(t order by t.created_at desc) from (
        select kind, bill_no, amount, points, method, created_at, reversed_at is not null as undone
        from transactions where customer_id = c.id order by created_at desc limit 5) t), '[]'::jsonb));
end $$;

create or replace function public.shop_dashboard(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s shops;
begin
  perform _require_member(p_shop, true);
  select * into s from shops where id = p_shop;
  return jsonb_build_object(
    'customers',      (select count(*) from customers where shop_id = p_shop),
    'customers_pin',  (select count(*) from customers where shop_id = p_shop and pin_hash is not null),
    'bills_30d',      (select count(*) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'sales_30d',      (select coalesce(sum(amount),0) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null and created_at > now() - interval '30 days'),
    'points_given',   (select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='earn' and reversed_at is null),
    'points_redeemed',(select coalesce(sum(points),0) from transactions where shop_id = p_shop and kind='redeem' and reversed_at is null),
    'redeems_pin',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='pin' and reversed_at is null),
    'redeems_otp',    (select count(*) from transactions where shop_id = p_shop and kind='redeem' and method='otp' and reversed_at is null),
    'points_owed',    (select coalesce(sum(points_left),0) from point_lots where shop_id = p_shop and points_left > 0 and expires_at > now()),
    'point_value',    s.point_value,
    'sms_30d',        (select count(*) from sms_log where shop_id = p_shop and created_at > now() - interval '30 days'),
    'sms_total',      (select count(*) from sms_log where shop_id = p_shop));
end $$;

create or replace function public.list_customers(p_shop uuid, p_search text default null)
returns table (mobile text, name text, balance int, visits bigint, has_pin boolean, pin_locked boolean, last_visit timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
    select c.mobile, c.name, _balance(c.id),
           (select count(*) from transactions t where t.customer_id = c.id and t.kind = 'earn' and t.reversed_at is null),
           c.pin_hash is not null, c.pin_hash is not null and c.pin_fails >= 3,
           (select max(created_at) from transactions t where t.customer_id = c.id and t.reversed_at is null)
    from customers c
    where c.shop_id = p_shop
      and (p_search is null or p_search = '' or c.name ilike '%' || p_search || '%'
           or c.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    order by 7 desc nulls last
    limit 200;
end $$;

drop function if exists public.recent_activity(uuid, int);
create function public.recent_activity(p_shop uuid, p_limit int default 50)
returns table (id bigint, created_at timestamptz, kind text, name text, mobile text, bill_no text,
               amount numeric, points int, method text, undone boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_member(p_shop);
  return query
    select t.id, t.created_at, t.kind, c.name, c.mobile, t.bill_no, t.amount, t.points, t.method, t.reversed_at is not null
    from transactions t join customers c on c.id = t.customer_id
    where t.shop_id = p_shop order by t.created_at desc limit least(p_limit, 200);
end $$;

revoke execute on function public.reverse_transaction(uuid, bigint), public.recent_activity(uuid, int) from public, anon;
grant execute on function public.reverse_transaction(uuid, bigint), public.recent_activity(uuid, int) to authenticated;
