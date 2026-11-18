// Kushly POS data: one call to load the menu, one to save a whole order, one to pay it.
import { rpc } from "../lib";
import { cancelLocal, claimDevice, flush, getLocal, hasDevice, hasPending, isNetworkError, mergeOpen, payLocal, remember, saveLocal } from "./offline";
import { totals } from "./money";
import type { Line, Totals } from "./money";

export type BizShop = { id: string; name: string; legal_name: string | null; gstin: string | null; address: string | null;
  contact_phone: string | null; gst_inclusive: boolean; upi_id: string | null; point_value: number; min_redeem: number;
  max_redeem_pct: number; logo_path: string | null; kitchen: boolean; timezone: string;
  use_tables?: boolean };   // false: no floor; the POS opens straight on the menu
export type Category = { id: string; name: string; sort: number };
export type Item = { id: string; category_id: string | null; name: string; price: number; gst_rate: number; hsn: string | null;
  veg: boolean; available: boolean; sort: number; track_stock?: boolean; stock?: number; low_stock?: number; options?: OptionGroup[] };
// Sizes or add-ons: pick one (radio) or many; each choice adds its price to the item's.
export type OptionGroup = { name: string; pick: "one" | "many"; choices: { name: string; price: number }[] };
export type Table = { id: string; name: string; sort: number };
export type Payment = { mode: "cash" | "upi" | "card"; amount: number };
// A credit note: items of a paid bill given back. Lines are the order's lines with the refunded qty and their index `i`.
export type Refund = { id: string; no: number; credit_no: string; at: string; lines: (Line & { i: number })[]; totals: Totals; mode: Payment["mode"]; reason: string | null; points_back?: number };
// Staff who say who they are with a PIN on a shared device (names and roles only; PINs stay on the server).
export type Staff = { id: string; name: string; role: "cashier" | "manager" };
export type Menu = { shop: BizShop; categories: Category[]; items: Item[]; tables: Table[]; staff?: Staff[] };

export type Order = {
  id: string; kind: "dine_in" | "takeaway"; table_id: string | null; status: "open" | "paid" | "cancelled" | "void"; lines: Line[];
  customer_mobile: string | null; customer_member: string | null; customer_name: string | null; redeem_request_id: string | null;
  opened_at: string; updated_at: string; paid_at: string | null; invoice_no: string | null; totals: Totals | null;
  payments: Payment[] | null; points_earned: number | null; points_error: string | null;
  total?: number; table?: string | null; txn_id?: number | null;
  void_reason?: string | null; voided_at?: string | null; refunds?: Refund[]; staff_id?: string | null; staff?: string | null;
  sent?: Record<string, number>; kitchen?: "new" | "cooking" | "ready" | null;
};

export type Ticket = { id: string; no: number; status: "new" | "cooking" | "ready" | "done"; created_at: string; updated_at: string;
  order_id: string; kind: string; table: string | null; cancelled: boolean; lines: { key: string; name: string; qty: number; note: string | null }[] };

// Same as _biz_line_key: one dish = same item with the same note.
// Same as _biz_line_key in the database: lines differ by item, note and options.
export const lineKey = (l: { item_id?: string | null; name: string; note?: string | null; opts?: string[] | null }) =>
  `${l.item_id ?? l.name}|${l.note ?? ""}${l.opts?.length ? `|${l.opts.join(", ")}` : ""}`;
export const sameOpts = (a?: string[] | null, b?: string[] | null) => (a ?? []).join("\u0001") === (b ?? []).join("\u0001");

export const loadMenu = (shop: string) => rpc<Menu>("biz_menu", { p_shop: shop });
type Draft = Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name" | "staff_id">;

// Orders go through the device's offline store (offline.ts): read from the server when possible,
// changes stored on the device first and sent in order.
export async function openOrders(shop: string, menu: Menu) {
  try { return mergeOpen(shop, await rpc<Order[]>("biz_open_orders", { p_shop: shop }), menu); }
  catch (e) { if (isNetworkError(e)) return mergeOpen(shop, null, menu); throw e; }
}
export async function getOrder(shop: string, id: string) {
  const mine = getLocal(shop, id);
  if (mine && hasPending(shop, id)) return mine;
  try { const o = await rpc<Order>("biz_invoice", { p_shop: shop, p_order: id }); remember(shop, o); return o; }
  catch (e) { if (isNetworkError(e) && mine) return mine; throw e; }
}
export const saveOrder = async (shop: string, o: Draft) => saveLocal(shop, o);
export async function preview(shop: string, id: string, menu: Menu) {
  if (!hasPending(shop, id)) {
    try { return await rpc<Totals>("biz_preview", { p_shop: shop, p_order: id }); } catch (e) { if (!isNetworkError(e)) throw e; }
  }
  return totals(getLocal(shop, id)?.lines ?? [], menu.shop.gst_inclusive);
}
// Paid on the device straight away (own invoice number), sent to the server now or when back online.
export async function payOrder(shop: string, menu: Menu, id: string, mode: "cash" | "upi" | "card", consent: boolean, parts?: Payment[] | null) {
  if (!hasDevice(shop)) await claimDevice(shop).catch(() => {});   // first bill on this device: get its invoice series
  payLocal(shop, menu, id, mode, consent, parts);
  await flush();
  return getLocal(shop, id)!;
}
export const cancelOrder = async (shop: string, id: string) => cancelLocal(shop, id);
// Refunds need the internet (owner only). The id is made here so a retry does not refund twice.
export async function refundOrder(shop: string, id: string, lines: { i: number; qty: number }[], mode: Payment["mode"], reason: string, refundId: string, approval?: string | null) {
  await flush();
  const o = await rpc<Order>("biz_refund_order", { p_shop: shop, p_order: id, p_id: refundId, p_lines: lines, p_mode: mode, p_reason: reason || null, ...(approval ? { p_approval: approval } : {}) });
  remember(shop, o); return o;
}
// Points need the internet (the customer approves in their app); send queued changes first.
export const applyRedemption = async (shop: string, id: string, request: string | null) => {
  await flush();
  const o = await rpc<Order>("biz_use_redemption", { p_shop: shop, p_order: id, p_request: request });
  remember(shop, o); return o;
};
export const sendToKitchen = async (shop: string, id: string) => {
  await flush();
  return rpc<{ id: string; no: number } | null>("biz_send_to_kitchen", { p_shop: shop, p_order: id });
};
export const kitchenTickets = (shop: string) => rpc<Ticket[]>("biz_kitchen", { p_shop: shop });
export const setTicketStatus = (shop: string, id: string, status: Ticket["status"]) => rpc("biz_ticket_status", { p_shop: shop, p_ticket: id, p_status: status });
export const startRedemption = async (shop: string, id: string, points: number) => {
  await flush();
  return rpc<{ request_id: string; points: number; discount: number }>("biz_start_redemption", { p_shop: shop, p_order: id, p_points: points });
};
