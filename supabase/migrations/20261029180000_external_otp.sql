-- OTPs made and checked by an outside service (Message Central Verify Now).
-- The provider creates the code and sends it; we keep its reference, count
-- tries, and redeem only after the provider says the code was right.
-- These functions are for the send-otp server function only (service role).

alter table public.otp_codes alter column code_hash drop not null;
alter table public.otp_codes add column provider_ref text;

-- Staff id is passed in when the server function redeems on the cashier's behalf.
drop function if exists public._do_redeem(uuid, uuid, numeric, int, text);
create function public._do_redeem(
  p_shop uuid, p_customer uuid, p_bill_amount numeric, p_points int, p_method text, p_staff uuid default null)
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
  values (p_shop, p_customer, 'redeem', p_bill_amount, p_points, p_method, coalesce(p_staff, auth.uid()))
  returning id into v_txn;

  return jsonb_build_object('ok', true, 'txn_id', v_txn, 'points', p_points,
    'discount', p_points * s.point_value,
    'pay', p_bill_amount - p_points * s.point_value,
    'balance', _balance(p_customer), 'method', p_method);
end $$;

-- Same limits as our own OTPs; returns an id to attach the provider's reference to.
create or replace function public.create_external_otp(p_shop uuid, p_mobile text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers; recent int; v_id bigint;
begin
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile);
  if not found then raise exception 'NO_CUSTOMER'; end if;
  select count(*) into recent from otp_codes where customer_id = c.id and created_at > now() - interval '15 minutes';
  if recent >= 3 then raise exception 'OTP_RATE_LIMIT'; end if;
  select count(*) into recent from otp_codes where shop_id = p_shop and created_at > now() - interval '1 day';
  if recent >= 300 then raise exception 'SHOP_OTP_DAILY_LIMIT'; end if;
  update otp_codes set used_at = now() where customer_id = c.id and used_at is null;
  insert into otp_codes (shop_id, customer_id, code_hash, expires_at)
  values (p_shop, c.id, null, now() + interval '5 minutes') returning id into v_id;
  return jsonb_build_object('otp_id', v_id, 'mobile', c.mobile, 'shop', (select name from shops where id = p_shop));
end $$;

create or replace function public.set_otp_ref(p_otp_id bigint, p_ref text)
returns void language sql security definer set search_path = public as $$
  update otp_codes set provider_ref = p_ref where id = p_otp_id;
$$;

-- Looks up the live external OTP for this customer, and checks the new PIN
-- before the provider is asked (so a bad PIN does not use up the code).
create or replace function public.pending_external_otp(p_shop uuid, p_mobile text, p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers; o otp_codes;
begin
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile);
  if not found then raise exception 'NO_CUSTOMER'; end if;
  if p_new_pin is not null and p_new_pin <> '' then perform _check_new_pin(p_new_pin); end if;
  select * into o from otp_codes
  where customer_id = c.id and used_at is null and expires_at > now() and provider_ref is not null
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;
  if o.tries >= 3 then return jsonb_build_object('ok', false, 'error', 'OTP_TOO_MANY_TRIES'); end if;
  return jsonb_build_object('ok', true, 'otp_id', o.id, 'ref', o.provider_ref, 'mobile', c.mobile);
end $$;

-- Records the provider's answer. On a right code: unlocks, sets the new PIN, redeems.
create or replace function public.redeem_with_external_otp(
  p_shop uuid, p_mobile text, p_bill_amount numeric, p_points int, p_new_pin text,
  p_staff uuid, p_otp_id bigint, p_valid boolean, p_expired boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c customers; o otp_codes;
begin
  if p_staff is null or not exists (select 1 from shop_members where shop_id = p_shop and user_id = p_staff) then
    raise exception 'NOT_A_MEMBER';
  end if;
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile) for update;
  if not found then raise exception 'NO_CUSTOMER'; end if;
  select * into o from otp_codes where id = p_otp_id and customer_id = c.id and used_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;

  if p_expired then
    update otp_codes set used_at = now() where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED');
  end if;
  if not p_valid then
    update otp_codes set tries = tries + 1, used_at = case when tries + 1 >= 3 then now() end where id = o.id;
    return jsonb_build_object('ok', false,
      'error', case when o.tries + 1 >= 3 then 'OTP_TOO_MANY_TRIES' else 'WRONG_OTP' end,
      'tries_left', greatest(0, 2 - o.tries));
  end if;

  update otp_codes set used_at = now() where id = o.id;
  update customers set pin_fails = 0,
    pin_hash = case when p_new_pin is not null and p_new_pin <> '' then crypt(p_new_pin, gen_salt('bf', 8)) else pin_hash end
  where id = c.id;
  return _do_redeem(p_shop, c.id, p_bill_amount, p_points, 'otp', p_staff)
         || jsonb_build_object('pin_set', p_new_pin is not null and p_new_pin <> '');
end $$;

revoke execute on function
  public._do_redeem(uuid, uuid, numeric, int, text, uuid),
  public.create_external_otp(uuid, text), public.set_otp_ref(bigint, text),
  public.pending_external_otp(uuid, text, text),
  public.redeem_with_external_otp(uuid, text, numeric, int, text, uuid, bigint, boolean, boolean)
from public, anon, authenticated;
grant execute on function
  public.create_external_otp(uuid, text), public.set_otp_ref(bigint, text),
  public.pending_external_otp(uuid, text, text),
  public.redeem_with_external_otp(uuid, text, numeric, int, text, uuid, bigint, boolean, boolean)
to service_role;

-- Our own OTP check must only ever match codes we made (never an external one).
create or replace function public.redeem_with_otp(
  p_shop uuid, p_mobile text, p_bill_amount numeric, p_points int, p_otp text, p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c customers; o otp_codes;
begin
  perform _require_member(p_shop);
  select * into c from customers where shop_id = p_shop and mobile = _clean_mobile(p_mobile) for update;
  if not found then raise exception 'NO_CUSTOMER'; end if;
  if p_new_pin is not null and p_new_pin <> '' then perform _check_new_pin(p_new_pin); end if;

  select * into o from otp_codes
  where customer_id = c.id and used_at is null and expires_at > now() and code_hash is not null
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;
  if o.tries >= 3 then return jsonb_build_object('ok', false, 'error', 'OTP_TOO_MANY_TRIES'); end if;
  if crypt(coalesce(p_otp,''), o.code_hash) is distinct from o.code_hash then
    update otp_codes set tries = tries + 1, used_at = case when tries + 1 >= 3 then now() end where id = o.id;
    return jsonb_build_object('ok', false,
      'error', case when o.tries + 1 >= 3 then 'OTP_TOO_MANY_TRIES' else 'WRONG_OTP' end,
      'tries_left', greatest(0, 2 - o.tries));
  end if;

  update otp_codes set used_at = now() where id = o.id;
  update customers set pin_fails = 0,
    pin_hash = case when p_new_pin is not null and p_new_pin <> '' then crypt(p_new_pin, gen_salt('bf', 8)) else pin_hash end
  where id = c.id;
  return _do_redeem(p_shop, c.id, p_bill_amount, p_points, 'otp')
         || jsonb_build_object('pin_set', p_new_pin is not null and p_new_pin <> '');
end $$;
