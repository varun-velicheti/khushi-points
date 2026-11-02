// pos-bill: billing software (Petpooja or any POS) sends each bill here; the customer gets points
// and a "You earned N points" notification in the Khushi Points app.
//
// POST https://<project>.supabase.co/functions/v1/pos-bill
// Header:  x-api-key: <shop's key from the Owner page>
// Body (JSON), any of these field names:
//   mobile | phone | customer_phone | customer.phone      customer's mobile number (required)
//   amount | total | grand_total | order.total            bill amount in rupees (required)
//   bill_no | order_id | invoice_no | order.orderID       bill number (recommended, stops duplicates)
//   items | note                                          receipt text or a list of item names
//   name | customer_name | customer.name                  customer's name (optional)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { env, errCode, json } from "../_shared/http.ts";
import { sendEarned } from "../_shared/expo.ts";

type Any = Record<string, unknown>;
const pick = (o: Any, paths: string[]): unknown => {
  for (const p of paths) {
    const v = p.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Any)[k] : undefined), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const key = req.headers.get("x-api-key") ?? new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith("kp_live_")) return json({ error: "BAD_POS_KEY" }, 401);
  const b = (await req.json().catch(() => ({}))) as Any;

  const mobile = pick(b, ["mobile", "phone", "customer_phone", "customer.phone", "customer.mobile", "Customer.phone"]);
  const amount = Number(pick(b, ["amount", "total", "grand_total", "order.total", "Order.total", "order.grand_total"]));
  const billNo = pick(b, ["bill_no", "order_id", "invoice_no", "order.orderID", "Order.orderID", "order.order_id"]);
  const name = pick(b, ["name", "customer_name", "customer.name", "Customer.name"]);
  const itemsRaw = pick(b, ["items", "note", "OrderItem", "order.items"]);
  const note = Array.isArray(itemsRaw)
    ? itemsRaw.map((i) => (typeof i === "string" ? i : [(i as Any).quantity, (i as Any).name].filter(Boolean).join(" "))).join(", ").slice(0, 300)
    : typeof itemsRaw === "string" ? itemsRaw.slice(0, 300) : null;

  if (!mobile) return json({ error: "MOBILE_REQUIRED" }, 400);
  if (!(amount > 0)) return json({ error: "BAD_AMOUNT" }, 400);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("pos_add_bill", {
    p_key: key, p_mobile: String(mobile), p_amount: amount,
    p_bill_no: billNo != null ? String(billNo) : null, p_note: note, p_name: name != null ? String(name) : null,
  });
  if (error) {
    const code = errCode(error.message, "POS_BILL_FAILED");
    // already credited / small bills are normal outcomes for a POS, not failures to retry
    const ok = ["BILL_ALREADY_USED", "BELOW_MIN_BILL", "LOWER_THAN_TODAYS_BILL", "TOO_SMALL_FOR_POINTS"].includes(code);
    return json({ ok: false, error: code }, code === "BAD_POS_KEY" ? 401 : ok ? 200 : 400);
  }
  const sent = await sendEarned(admin, Number(data.txn_id));
  return json({ ok: true, points: data.points, balance: data.balance, notified: sent > 0 });
});
