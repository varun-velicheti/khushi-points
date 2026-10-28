// send-otp: creates a redemption OTP for a customer and sends it by SMS.
//
// Called by signed-in shop staff from the counter app. The OTP is created with
// the service role, so staff never see it (except in demo mode, for testing).
//
// Settings (Supabase dashboard > Edge Functions > Secrets):
//   SMS_PROVIDER        demo | msg91 | 2factor      (default: demo)
//   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID               when SMS_PROVIDER=msg91
//   TWOFACTOR_API_KEY, TWOFACTOR_TEMPLATE           when SMS_PROVIDER=2factor
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type SendResult = { status: "sent" | "failed" | "demo"; ref?: string };

async function sendSms(provider: string, mobile: string, code: string, shop: string): Promise<SendResult> {
  if (provider === "msg91") {
    // MSG91 Flow API. The DLT-approved template should read something like:
    // "##otp## is your OTP to redeem points at ##shop##. Valid 5 minutes. Do not share. - Khushi Points"
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: Deno.env.get("MSG91_AUTH_KEY") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: Deno.env.get("MSG91_TEMPLATE_ID"),
        short_url: "0",
        recipients: [{ mobiles: "91" + mobile, otp: code, shop: shop.slice(0, 30) }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.ok && body?.type !== "error" ? "sent" : "failed", ref: body?.message };
  }
  if (provider === "2factor") {
    const key = Deno.env.get("TWOFACTOR_API_KEY") ?? "";
    const tpl = Deno.env.get("TWOFACTOR_TEMPLATE") ?? "";
    const res = await fetch(
      `https://2factor.in/API/V1/${encodeURIComponent(key)}/SMS/${mobile}/${code}/${encodeURIComponent(tpl)}`,
    );
    const body = await res.json().catch(() => ({}));
    return { status: res.ok && body?.Status === "Success" ? "sent" : "failed", ref: body?.Details };
  }
  return { status: "demo" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const { shop_id, mobile } = await req.json().catch(() => ({}));
  if (!shop_id || !mobile) return json({ error: "BAD_REQUEST" }, 400);

  // 1. caller must be signed-in staff of this shop
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: member, error: memberErr } = await asUser.rpc("is_member", { p_shop: shop_id });
  if (memberErr || member !== true) return json({ error: "NOT_A_MEMBER" }, 403);

  // 2. create the code with the service role
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: otp, error } = await admin.rpc("create_otp", { p_shop: shop_id, p_mobile: String(mobile) });
  if (error) {
    const code = (error.message.match(/[A-Z_]{4,}/) ?? ["OTP_FAILED"])[0];
    return json({ error: code });
  }

  // 3. send it
  const provider = (Deno.env.get("SMS_PROVIDER") ?? "demo").toLowerCase();
  let result: SendResult;
  try {
    result = await sendSms(provider, otp.mobile, otp.code, otp.shop);
  } catch (e) {
    result = { status: "failed", ref: String(e).slice(0, 200) };
  }
  await admin.rpc("log_sms", {
    p_shop: shop_id, p_mobile: otp.mobile, p_kind: "otp",
    p_provider: provider, p_status: result.status, p_ref: result.ref ?? null,
  });

  if (result.status === "failed") return json({ error: "SMS_FAILED" });
  return json({ sent: true, demo: result.status === "demo", ...(result.status === "demo" ? { demo_code: otp.code } : {}) });
});
