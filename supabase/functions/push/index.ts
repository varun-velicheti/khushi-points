// push: app notifications to customers (Expo push service).
//   { action: "offer",  shop_id, offer_id }     owner sends a new offer to the shop's followers
//   { action: "redeem", shop_id, request_id }   cashier asks the customer to approve a redemption
// Never sends SMS or WhatsApp.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, env, json } from "../_shared/http.ts";

type Msg = { to: string; title: string; body: string; data: Record<string, unknown>; sound?: string; priority?: string; channelId?: string };

async function sendExpo(admin: SupabaseClient, msgs: Msg[]) {
  let sent = 0;
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100);
    const res = await fetch(env("EXPO_PUSH_URL") || "https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", accept: "application/json",
        ...(env("EXPO_ACCESS_TOKEN") ? { Authorization: `Bearer ${env("EXPO_ACCESS_TOKEN")}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    const body = await res.json().catch(() => ({}));
    const tickets: { status: string; details?: { error?: string } }[] = body?.data ?? [];
    for (let j = 0; j < tickets.length; j++) {
      if (tickets[j].status === "ok") sent++;
      else if (tickets[j].details?.error === "DeviceNotRegistered") await admin.rpc("push_token_remove", { p_token: chunk[j].to });
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const b = await req.json().catch(() => ({}));
  if (!b.shop_id) return json({ error: "BAD_REQUEST" }, 400);

  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const ownerOnly = b.action === "offer";
  const { data: ok } = await asUser.rpc("is_member", { p_shop: b.shop_id, p_owner_only: ownerOnly });
  if (ok !== true) return json({ error: ownerOnly ? "OWNER_ONLY" : "NOT_A_MEMBER" }, 403);
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  if (b.action === "offer") {
    const { data: rows, error } = await admin.rpc("push_targets_for_offer", { p_offer: b.offer_id });
    if (error) return json({ error: "PUSH_FAILED" });
    const msgs: Msg[] = (rows ?? []).map((r: { token: string; shop_name: string; title: string; body: string }) => ({
      to: r.token, title: `${r.shop_name}: ${r.title}`, body: r.body || "Tap to see the offer",
      data: { type: "offer", shop_id: b.shop_id, offer_id: b.offer_id }, channelId: "offers",
    }));
    return json({ sent: msgs.length ? await sendExpo(admin, msgs) : 0, devices: msgs.length });
  }

  if (b.action === "redeem") {
    const { data: rows, error } = await admin.rpc("push_targets_for_request", { p_request: b.request_id });
    if (error) return json({ error: "PUSH_FAILED" });
    const msgs: Msg[] = (rows ?? []).map((r: { token: string; shop_name: string; points: number; discount: number }) => ({
      to: r.token, title: `Approve ₹${r.discount} off at ${r.shop_name}?`,
      body: `Use ${r.points} points on your bill. Open to approve.`,
      data: { type: "redeem", request_id: b.request_id }, sound: "default", priority: "high", channelId: "redeem",
    }));
    return json({ sent: msgs.length ? await sendExpo(admin, msgs) : 0, devices: msgs.length });
  }

  return json({ error: "BAD_REQUEST" }, 400);
});
