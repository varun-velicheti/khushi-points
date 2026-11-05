// push: app notifications to customers (Expo push service).
//   { action: "offer",  shop_id, offer_id }     owner sends a new offer to the shop's followers
//   { action: "redeem", shop_id, request_id }   cashier asks the customer to approve a redemption
//   { action: "earn",   shop_id, txn_id }       "You earned N points" after a bill at the counter
//   { action: "winback", shop_id, winback_id }  owner's note to customers who have not been back
// Never sends SMS or WhatsApp.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, env, json } from "../_shared/http.ts";
import { sendEarned, sendExpo, type PushMsg as Msg } from "../_shared/expo.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const b = await req.json().catch(() => ({}));
  if (!b.shop_id) return json({ error: "BAD_REQUEST" }, 400);

  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const ownerOnly = b.action === "offer" || b.action === "winback";
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

  if (b.action === "winback") {
    const { data: rows, error } = await admin.rpc("push_targets_for_winback", { p_winback: b.winback_id });
    if (error) return json({ error: "PUSH_FAILED" });
    const msgs: Msg[] = (rows ?? []).filter((r: { shop_id: string }) => r.shop_id === b.shop_id)
      .map((r: { token: string; shop_name: string; message: string; gift_title: string | null }) => ({
        to: r.token, title: r.gift_title ? `${r.shop_name} has a gift for you: ${r.gift_title}` : `A note from ${r.shop_name}`,
        body: r.message, data: { type: "winback", shop_id: b.shop_id }, channelId: "offers",
      }));
    return json({ sent: msgs.length ? await sendExpo(admin, msgs) : 0, devices: msgs.length });
  }

  if (b.action === "earn") {
    const { data: txn } = await admin.from("transactions").select("shop_id").eq("id", b.txn_id).maybeSingle();
    if (!txn || txn.shop_id !== b.shop_id) return json({ error: "NOT_FOUND" }, 404);
    return json({ sent: await sendEarned(admin, Number(b.txn_id)) });
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
