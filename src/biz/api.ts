// Khushi Biz data: one call to load the menu, one to save a whole order, one to pay it.
import { rpc } from "../lib";
import { cancelLocal, flush, getLocal, hasPending, isNetworkError, mergeOpen, payLocal, remember, saveLocal } from "./offline";
import { totals } from "./money";
import type { Line, Totals } from "./money";

export type BizShop = { id: string; name: string; legal_name: string | null; gstin: string | null; address: string | null;
  contact_phone: string | null; gst_inclusive: boolean; upi_id: string | null; point_value: number; min_redeem: number;
  max_redeem_pct: number; logo_path: string | null; kitchen: boolean; timezone: string };
export type Category = { id: string; name: string; sort: number };
export type Item = { id: string; category_id: string | null; name: string; price: number; gst_rate: number; hsn: string | null;
  veg: boolean; available: boolean; sort: number; track_stock?: boolean; stock?: number; low_stock?: number };
export type Table = { id: string; name: string; sort: number };
export type Menu = { shop: BizShop; categories: Category[]; items: Item[]; tables: Table[] };

export type Order = {
  id: string; kind: "dine_in" | "takeaway"; table_id: string | null; status: "open" | "paid" | "cancelled" | "void"; lines: Line[];
  customer_mobile: string | null; customer_member: string | null; customer_name: string | null; redeem_request_id: string | null;
  opened_at: string; updated_at: string; paid_at: string | null; invoice_no: string | null; totals: Totals | null;
  payments: { mode: string; amount: number }[] | null; points_earned: number | null; points_error: string | null;
  total?: number; table?: string | null; txn_id?: number | null;
  void_reason?: string | null; voided_at?: string | null;
  sent?: Record<string, number>; kitchen?: "new" | "cooking" | "ready" | null;
};

export type Ticket = { id: string; no: number; status: "new" | "cooking" | "ready" | "done"; created_at: string; updated_at: string;
  order_id: string; kind: string; table: string | null; cancelled: boolean; lines: { key: string; name: string; qty: number; note: string | null }[] };

// Same as _biz_line_key: one dish = same item with the same note.
export const lineKey = (l: { item_id?: string | null; name: string; note?: string | null }) => `${l.item_id ?? l.name}|${l.note ?? ""}`;

export const loadMenu = (shop: string) => rpc<Menu>("biz_menu", { p_shop: shop });
type Draft = Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name">;

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
export async function payOrder(shop: string, menu: Menu, id: string, mode: "cash" | "upi" | "card", consent: boolean) {
  payLocal(shop, menu, id, mode, consent);
  await flush();
  return getLocal(shop, id)!;
}
export const cancelOrder = async (shop: string, id: string) => cancelLocal(shop, id);
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
