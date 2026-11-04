-- A shop can add points to the number of an existing Khushi Points app user without the
-- consent tick-box: they agreed to the app's terms when they verified that number.
create or replace function public._customer_for(
  p_shop uuid, p_mobile text, p_member text, p_name text, p_consent boolean, p_create boolean)
returns public.customers language plpgsql security definer set search_path = public as $$
declare c customers; u app_users; m text;
begin
  if nullif(trim(coalesce(p_member, '')), '') is not null then
    select * into u from app_users
    where member_code = upper(regexp_replace(trim(p_member), '^KP:', '', 'i'));
    if not found then raise exception 'BAD_MEMBER_CODE'; end if;
    select * into c from customers
    where shop_id = p_shop and (app_user_id = u.user_id or (u.phone is not null and mobile = u.phone))
    order by (app_user_id = u.user_id) desc nulls last limit 1 for update;
    if found then
      if c.app_user_id is null then
        update customers set app_user_id = u.user_id where id = c.id returning * into c;
      end if;
    elsif p_create then
      -- the customer agreed to the app's terms, so no separate consent tick is needed
      insert into customers (shop_id, mobile, name, app_user_id)
      values (p_shop, u.phone, coalesce(nullif(trim(p_name), ''), u.name, 'Customer'), u.user_id)
      returning * into c;
    else
      return null;
    end if;
    insert into shop_follows (user_id, shop_id) values (u.user_id, p_shop) on conflict do nothing;
    return c;
  end if;

  m := _clean_mobile(p_mobile);
  select * into c from customers where shop_id = p_shop and mobile = m for update;
  if not found then
    if not p_create then return null; end if;
    -- someone who verified this number in the app already agreed to the app's terms
    if not coalesce(p_consent, false) and not exists (select 1 from app_users where phone = m) then
      raise exception 'CONSENT_REQUIRED';
    end if;
    insert into customers (shop_id, mobile, name) values (p_shop, m, coalesce(nullif(trim(p_name), ''), 'Customer'))
    on conflict (shop_id, mobile) do nothing;
    select * into c from customers where shop_id = p_shop and mobile = m for update;
  end if;
  -- someone with the app already verified this number: connect them
  if c.app_user_id is null then
    select * into u from app_users where phone = m;
    if found and not exists (select 1 from customers where shop_id = p_shop and app_user_id = u.user_id) then
      update customers set app_user_id = u.user_id where id = c.id returning * into c;
      insert into shop_follows (user_id, shop_id) values (u.user_id, p_shop) on conflict do nothing;
    end if;
  end if;
  return c;
end $$;
