-- Phone sign-in for the customer app (codes requested by the customer only).
-- Used by the customer-auth server function with the service role.

create or replace function public.app_login_start(p_phone text, p_ref text, p_code_hash text)
returns bigint language plpgsql security definer set search_path = public as $$
declare m text := _clean_mobile(p_phone); n int; v_id bigint;
begin
  select count(*) into n from app_login_codes where phone = m and created_at > now() - interval '15 minutes';
  if n >= 3 then raise exception 'OTP_RATE_LIMIT'; end if;
  select count(*) into n from app_login_codes where phone = m and created_at > now() - interval '1 day';
  if n >= 10 then raise exception 'OTP_RATE_LIMIT'; end if;
  update app_login_codes set used_at = now() where phone = m and used_at is null;
  insert into app_login_codes (phone, code_hash, provider_ref) values (m, p_code_hash, p_ref) returning id into v_id;
  return v_id;
end $$;

create or replace function public.app_login_set_ref(p_id bigint, p_ref text)
returns void language sql security definer set search_path = public as $$
  update app_login_codes set provider_ref = p_ref where id = p_id;
$$;

create or replace function public.app_login_pending(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r app_login_codes;
begin
  select * into r from app_login_codes
  where phone = _clean_mobile(p_phone) and used_at is null and expires_at > now()
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;
  if r.tries >= 3 then return jsonb_build_object('ok', false, 'error', 'OTP_TOO_MANY_TRIES'); end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'phone', r.phone, 'ref', r.provider_ref, 'code_hash', r.code_hash);
end $$;

-- Records a wrong code (3 tries max) or uses up the code after a right one.
create or replace function public.app_login_result(p_id bigint, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r app_login_codes;
begin
  select * into r from app_login_codes where id = p_id and used_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED'); end if;
  if p_ok then
    update app_login_codes set used_at = now() where id = p_id;
    return jsonb_build_object('ok', true);
  end if;
  update app_login_codes set tries = tries + 1, used_at = case when tries + 1 >= 3 then now() end where id = p_id;
  return jsonb_build_object('ok', false,
    'error', case when r.tries + 1 >= 3 then 'OTP_TOO_MANY_TRIES' else 'WRONG_OTP' end,
    'tries_left', greatest(0, 2 - r.tries));
end $$;

create or replace function public.app_user_by_phone(p_phone text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from app_users where phone = _clean_mobile(p_phone);
$$;

create or replace function public.push_token_remove(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token;
$$;

revoke execute on function public.app_login_start(text, text, text), public.app_login_set_ref(bigint, text),
  public.app_login_pending(text), public.app_login_result(bigint, boolean), public.app_user_by_phone(text),
  public.push_token_remove(text)
from public, anon, authenticated;
grant execute on function public.app_login_start(text, text, text), public.app_login_set_ref(bigint, text),
  public.app_login_pending(text), public.app_login_result(bigint, boolean), public.app_user_by_phone(text),
  public.push_token_remove(text)
to service_role;
