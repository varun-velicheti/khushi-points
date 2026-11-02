import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { env } from "./http.ts";

export type PushMsg = {
  to: string; title: string; body: string; data: Record<string, unknown>;
  sound?: string; priority?: string; channelId?: string;
};

// Sends through Expo's push service in batches of 100; forgets phones that uninstalled the app.
export async function sendExpo(admin: SupabaseClient, msgs: PushMsg[]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100);
    try {
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
    } catch { /* push is best effort; the app also refreshes on open */ }
  }
  return sent;
}

type EarnRow = { token: string; shop_id: string; shop_name: string; points: number; balance: number };
export async function sendEarned(admin: SupabaseClient, txnId: number): Promise<number> {
  const { data } = await admin.rpc("push_targets_for_earn", { p_txn: txnId });
  const msgs: PushMsg[] = ((data ?? []) as EarnRow[]).map((r) => ({
    to: r.token, title: `You earned ${r.points} points at ${r.shop_name}`,
    body: `You now have ${r.balance} points there.`, channelId: "earned",
    data: { type: "earn", shop_id: r.shop_id },
  }));
  return msgs.length ? sendExpo(admin, msgs) : 0;
}
