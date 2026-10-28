-- Daily rule change: instead of only the first bill of the day, the HIGHEST
-- bill of the day earns points. A bigger bill later the same day tops the
-- customer up to what that bill earns; a smaller one earns nothing.
-- (shops.one_bill_per_day = false still means every bill earns.)

create or replace function public.add_bill(
  p_shop uuid, p_mobile text, p_bill_no text, p_amount numeric,
  p_name text default null, p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s shops; c customers; m text; pts int; is_new boolean := false; bill text;
  today_pts int := 0; today_max numeric := 0; award int;
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

  if exists (select 1 from transactions where shop_id = p_shop and kind = 'earn' and upper(bill_no) = bill) then
    raise exception 'BILL_ALREADY_USED';
  end if;

  pts := floor(p_amount * s.earn_pct / 100 / s.point_value);
  if pts < 1 then raise exception 'TOO_SMALL_FOR_POINTS'; end if;
  award := pts;

  if s.one_bill_per_day then
    select coalesce(sum(points), 0), coalesce(max(amount), 0) into today_pts, today_max
    from transactions
    where customer_id = c.id and kind = 'earn'
      and (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
    if today_pts > 0 then
      if p_amount <= today_max then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
      award := pts - today_pts;            -- top up to what the highest bill earns
      if award < 1 then raise exception 'LOWER_THAN_TODAYS_BILL'; end if;
    end if;
  end if;

  insert into transactions (shop_id, customer_id, kind, bill_no, amount, points, staff_id)
  values (p_shop, c.id, 'earn', bill, p_amount, award, auth.uid());
  insert into point_lots (shop_id, customer_id, points, points_left, expires_at)
  values (p_shop, c.id, award, award, now() + make_interval(days => s.expiry_days));

  return jsonb_build_object('points', award, 'bill_points', pts,
    'topped_up', today_pts > 0, 'earlier_today', today_pts, 'earlier_bill', today_max,
    'balance', _balance(c.id), 'value', _balance(c.id) * s.point_value,
    'name', c.name, 'is_new', is_new);
end $$;

revoke execute on function public.add_bill(uuid, text, text, numeric, text, boolean) from public, anon;
grant execute on function public.add_bill(uuid, text, text, numeric, text, boolean) to authenticated;
