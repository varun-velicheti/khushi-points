// send-otp: sends a redemption OTP to a customer, and (for Verify Now) checks it.
//
// Called by signed-in shop staff from the counter app. Staff never see the code
// (except in demo mode, for testing).
//
// Requests (POST JSON):
//   { action: "send",   shop_id, mobile }
//   { action: "redeem", shop_id, mobile, bill_amount, points, otp, new_pin }   (Verify Now only)
//
// Settings (Supabase dashboard > Edge Functions > Secrets):
//   SMS_PROVIDER        demo | verifynow | msg91 | 2factor     (default: demo)
//   MESSAGECENTRAL_CUSTOMER_ID, MESSAGECENTRAL_PASSWORD       when SMS_PROVIDER=verifynow
//   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID                         when SMS_PROVIDER=msg91
//   TWOFACTOR_API_KEY, TWOFACTOR_TEMPLATE                     when SMS_PROVIDER=2factor
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const errCode = (msg: string, fallback: string) => (msg.match(/[A-Z][A-Z_]{3,}/) ?? [fallback])[0];

const env = (k: string) => Deno.env.get(k) ?? "";
const provider = () => (env("SMS_PROVIDER") || "demo").toLowerCase();

// ---------------------------------------------------------------- Message Central Verify Now
// They create the code, send it from their approved sender ID, and check it.

const VN_BASE = env("MESSAGECENTRAL_BASE_URL") || "https://cpaas.messagecentral.com";
let vnToken: { value: string; at: number } | null = null;

async function vnAuth(): Promise<string> {
  if (vnToken && Date.now() - vnToken.at < 10 * 60 * 1000) return vnToken.value;
  const q = new URLSearchParams({
    customerId: env("MESSAGECENTRAL_CUSTOMER_ID"),
    key: btoa(env("MESSAGECENTRAL_PASSWORD")),
    scope: "NEW",
    country: "91",
  });
  const res = await fetch(`${VN_BASE}/auth/v1/authentication/token?${q}`, { headers: { accept: "*/*" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.token) throw new Error("VERIFYNOW_AUTH_FAILED " + JSON.stringify(body).slice(0, 200));
  vnToken = { value: body.token, at: Date.now() };
  return body.token;
}

async function vnSend(mobile: string): Promise<{ ok: boolean; ref?: string; detail?: string }> {
  const q = new URLSearchParams({
    countryCode: "91", customerId: env("MESSAGECENTRAL_CUSTOMER_ID"),
    flowType: "SMS", mobileNumber: mobile, otpLength: "6",
  });
  const res = await fetch(`${VN_BASE}/verification/v3/send?${q}`, { method: "POST", headers: { authToken: await vnAuth() } });
  const body = await res.json().catch(() => ({}));
  const ref = body?.data?.verificationId;
  return ref ? { ok: true, ref: String(ref) } : { ok: false, detail: JSON.stringify(body).slice(0, 200) };
}

async function vnCheck(mobile: string, ref: string, code: string): Promise<"valid" | "wrong" | "expired"> {
  const q = new URLSearchParams({
    countryCode: "91", mobileNumber: mobile, verificationId: ref,
    customerId: env("MESSAGECENTRAL_CUSTOMER_ID"), code,
  });
  const res = await fetch(`${VN_BASE}/verification/v3/validateOtp?${q}`, { headers: { authToken: await vnAuth() } });
  const body = await res.json().catch(() => ({}));
  if (body?.data?.verificationStatus === "VERIFICATION_COMPLETED") return "valid";
  // 705 = expired, 800 = too many attempts at the provider
  if (body?.responseCode === 705 || body?.responseCode === 800 || /EXPIRED/i.test(JSON.stringify(body))) return "expired";
  return "wrong";
}

// ---------------------------------------------------------------- DLT providers (we make the code)

async function sendOwnCode(p: string, mobile: string, code: string, shop: string): Promise<{ status: "sent" | "failed" | "demo"; ref?: string }> {
  if (p === "msg91") {
    // DLT template, e.g. "##otp## is your OTP to redeem points at ##shop##. Valid 5 minutes. Do not share. - Khushi Points"
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTH_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: env("MSG91_TEMPLATE_ID"), short_url: "0",
        recipients: [{ mobiles: "91" + mobile, otp: code, shop: shop.slice(0, 30) }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.ok && body?.type !== "error" ? "sent" : "failed", ref: body?.message };
  }
  if (p === "2factor") {
    const res = await fetch(
      `https://2factor.in/API/V1/${encodeURIComponent(env("TWOFACTOR_API_KEY"))}/SMS/${mobile}/${code}/${encodeURIComponent(env("TWOFACTOR_TEMPLATE"))}`,
    );
    const body = await res.json().catch(() => ({}));
    return { status: res.ok && body?.Status === "Success" ? "sent" : "failed", ref: body?.Details };
  }
  return { status: "demo" };
}

// ---------------------------------------------------------------- actions

async function send(admin: SupabaseClient, shopId: string, mobile: string) {
  const p = provider();
  const log = (m: string, status: string, ref: string | null) =>
    admin.rpc("log_sms", { p_shop: shopId, p_mobile: m, p_kind: "otp", p_provider: p, p_status: status, p_ref: ref });

  if (p === "verifynow") {
    const { data: otp, error } = await admin.rpc("create_external_otp", { p_shop: shopId, p_mobile: mobile });
    if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
    let r: { ok: boolean; ref?: string; detail?: string };
    try { r = await vnSend(otp.mobile); } catch (e) { r = { ok: false, detail: String(e).slice(0, 200) }; }
    await log(otp.mobile, r.ok ? "sent" : "failed", r.ok ? r.ref! : r.detail ?? null);
    if (!r.ok) return json({ error: "SMS_FAILED" });
    await admin.rpc("set_otp_ref", { p_otp_id: otp.otp_id, p_ref: r.ref });
    return json({ sent: true, external: true });
  }

  const { data: otp, error } = await admin.rpc("create_otp", { p_shop: shopId, p_mobile: mobile });
  if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
  let result: { status: "sent" | "failed" | "demo"; ref?: string };
  try { result = await sendOwnCode(p, otp.mobile, otp.code, otp.shop); }
  catch (e) { result = { status: "failed", ref: String(e).slice(0, 200) }; }
  await log(otp.mobile, result.status, result.ref ?? null);
  if (result.status === "failed") return json({ error: "SMS_FAILED" });
  return json({ sent: true, demo: result.status === "demo", ...(result.status === "demo" ? { demo_code: otp.code } : {}) });
}

async function redeem(admin: SupabaseClient, staffId: string, b: Record<string, unknown>) {
  if (provider() !== "verifynow") return json({ error: "NOT_EXTERNAL" }, 400);
  const newPin = (b.new_pin as string) || null;
  const { data: pend, error } = await admin.rpc("pending_external_otp", { p_shop: b.shop_id, p_mobile: String(b.mobile), p_new_pin: newPin });
  if (error) return json({ error: errCode(error.message, "OTP_FAILED") });
  if (!pend.ok) return json(pend);

  let verdict: "valid" | "wrong" | "expired";
  try { verdict = await vnCheck(pend.mobile, pend.ref, String(b.otp ?? "")); }
  catch { return json({ error: "SMS_FAILED" }); }

  const { data, error: e2 } = await admin.rpc("redeem_with_external_otp", {
    p_shop: b.shop_id, p_mobile: pend.mobile, p_bill_amount: b.bill_amount, p_points: b.points,
    p_new_pin: newPin, p_staff: staffId, p_otp_id: pend.otp_id,
    p_valid: verdict === "valid", p_expired: verdict === "expired",
  });
  if (e2) return json({ error: errCode(e2.message, "REDEEM_FAILED") });
  return json(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const url = env("SUPABASE_URL");
  const body = await req.json().catch(() => ({}));
  const shopId = body.shop_id as string | undefined;
  if (!shopId || !body.mobile) return json({ error: "BAD_REQUEST" }, 400);

  // caller must be signed-in staff of this shop
  const asUser = createClient(url, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const { data: member } = await asUser.rpc("is_member", { p_shop: shopId });
  if (!userData?.user || member !== true) return json({ error: "NOT_A_MEMBER" }, 403);

  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"));
  if ((body.action ?? "send") === "redeem") return redeem(admin, userData.user.id, body);
  return send(admin, shopId, String(body.mobile));
});
