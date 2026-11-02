// customer-auth: phone sign-in for the Khushi Points customer app.
//
// The customer asks for a one-time code; nothing else is ever sent by SMS.
//   { action: "send",   phone }          -> sends the code
//   { action: "verify", phone, code }    -> signed out: returns sign-in details for that phone
//                                           signed in (Google/Apple): adds the verified phone to the account
//
// Uses SMS_PROVIDER: verifynow (Message Central makes and checks the code) or demo (code returned, testing only).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, env, errCode, json } from "../_shared/http.ts";
import { vnCheck, vnSend } from "../_shared/verifynow.ts";

const provider = () => (env("SMS_PROVIDER") || "demo").toLowerCase();
const clean = (p: unknown) => {
  let m = String(p ?? "").replace(/\D/g, "");
  if (m.length === 12 && m.startsWith("91")) m = m.slice(2);
  return /^[6-9]\d{9}$/.test(m) ? m : null;
};
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const hashCode = (phone: string, code: string) => sha256(`${phone}:${code}:${env("SUPABASE_SERVICE_ROLE_KEY")}`);
const randomPassword = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "") + "aA1!";
};
// Phone-only customers get an internal email so the standard sign-in works; it is never mailed.
const phoneEmail = (phone: string) => `p91${phone}@phone.khushipoints.app`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const body = await req.json().catch(() => ({}));
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Customer deletes their own app account (shops keep their own bill records).
  if (body.action === "delete") {
    const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: who } = await asUser.auth.getUser();
    if (!who?.user) return json({ error: "NOT_SIGNED_IN" }, 401);
    const { data: staff } = await admin.rpc("app_is_staff", { p_user: who.user.id });
    if (staff === true) return json({ error: "STAFF_ACCOUNT" });
    const { error } = await admin.auth.admin.deleteUser(who.user.id);
    return error ? json({ error: "DELETE_FAILED" }) : json({ ok: true });
  }

  const phone = clean(body.phone);
  if (!phone) return json({ error: "BAD_MOBILE" });

  if (body.action === "send") {
    const p = provider();
    if (p === "verifynow") {
      const { data: id, error } = await admin.rpc("app_login_start", { p_phone: phone, p_ref: null, p_code_hash: null });
      if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
      let r: { ok: boolean; ref?: string };
      try { r = await vnSend(phone); } catch { r = { ok: false }; }
      if (!r.ok) return json({ error: "SMS_FAILED" });
      await admin.rpc("app_login_set_ref", { p_id: id, p_ref: r.ref });
      return json({ sent: true });
    }
    // demo: we make the code and show it in the app (never use with real customers)
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const { error } = await admin.rpc("app_login_start", { p_phone: phone, p_ref: null, p_code_hash: await hashCode(phone, code) });
    if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
    return json({ sent: true, demo_code: code });
  }

  if (body.action === "verify") {
    const code = String(body.code ?? "").trim();
    const { data: pend, error } = await admin.rpc("app_login_pending", { p_phone: phone });
    if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
    if (!pend.ok) return json(pend);

    let ok = false;
    if (pend.ref) {
      let v: "valid" | "wrong" | "expired";
      try { v = await vnCheck(phone, pend.ref, code); } catch { return json({ error: "SMS_FAILED" }); }
      if (v === "expired") { await admin.rpc("app_login_result", { p_id: pend.id, p_ok: false }); return json({ ok: false, error: "OTP_EXPIRED" }); }
      ok = v === "valid";
    } else if (pend.code_hash) {
      ok = (await hashCode(phone, code)) === pend.code_hash;
    }
    const { data: res } = await admin.rpc("app_login_result", { p_id: pend.id, p_ok: ok });
    if (!ok) return json(res ?? { ok: false, error: "WRONG_OTP" });

    // Signed in already (Google/Apple): add this phone to the account.
    const authz = req.headers.get("Authorization") ?? "";
    const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authz } } });
    const { data: who } = await asUser.auth.getUser();
    if (who?.user && !who.user.email?.endsWith("@phone.khushipoints.app") && body.attach) {
      const { data, error: e } = await admin.rpc("app_attach_phone", { p_user: who.user.id, p_phone: phone });
      if (e) return json({ error: errCode(e.message, "ATTACH_FAILED") });
      return json({ ok: true, attached: true, ...data });
    }

    // Signing in with the phone: find or create the account, hand back one-time sign-in details.
    const password = randomPassword();
    const { data: existing } = await admin.rpc("app_user_by_phone", { p_phone: phone });
    let userId = existing as string | null;
    let email = phoneEmail(phone);
    if (userId) {
      const { data: u, error: e } = await admin.auth.admin.updateUserById(userId, { password });
      if (e) return json({ error: "SIGNIN_FAILED" });
      email = u.user.email ?? email;
    } else {
      const { data: u, error: e } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { phone } });
      if (e || !u.user) return json({ error: "SIGNIN_FAILED" });
      userId = u.user.id;
      const { error: e2 } = await admin.rpc("app_attach_phone", { p_user: userId, p_phone: phone });
      if (e2) return json({ error: errCode(e2.message, "SIGNIN_FAILED") });
    }
    return json({ ok: true, email, password });
  }

  return json({ error: "BAD_REQUEST" }, 400);
});
