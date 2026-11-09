// Khushi Biz data: one call to load the menu, one to save a whole order, one to pay it.
import { rpc } from "../lib";
import type { Line, Totals } from "./money";

export type BizShop = { id: string; name: string; legal_name: string | null; gstin: string | null; address: string | null;
  contact_phone: string | null; gst_inclusive: boolean; upi_id: string | null; point_value: number; min_redeem: number;
  max_redeem_pct: number; logo_path: string | null };
export type Category = { id: string; name: string; sort: number };
export type Item = { id: string; category_id: string | null; name: string; price: number; gst_rate: number; hsn: string | null;
  veg: boolean; available: boolean; sort: number };
export type Table = { id: string; name: string; sort: number };
export type Menu = { shop: BizShop; categories: Category[]; items: Item[]; tables: Table[] };

export type Order = {
  id: string; kind: "dine_in" | "takeaway"; table_id: string | null; status: "open" | "paid" | "cancelled"; lines: Line[];
  customer_mobile: string | null; customer_member: string | null; customer_name: string | null; redeem_request_id: string | null;
  opened_at: string; updated_at: string; paid_at: string | null; invoice_no: string | null; totals: Totals | null;
  payments: { mode: string; amount: number }[] | null; points_earned: number | null; points_error: string | null;
  total?: number; table?: string | null; txn_id?: number | null;
};

export const loadMenu = (shop: string) => rpc<Menu>("biz_menu", { p_shop: shop });
export const openOrders = (shop: string) => rpc<Order[]>("biz_open_orders", { p_shop: shop });
export const getOrder = (shop: string, id: string) => rpc<Order>("biz_invoice", { p_shop: shop, p_order: id });
export const saveOrder = (shop: string, o: Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name">) =>
  rpc<Order>("biz_save_order", { p_shop: shop, p: o });
export const preview = (shop: string, id: string) => rpc<Totals>("biz_preview", { p_shop: shop, p_order: id });
export const payOrder = (shop: string, id: string, mode: "cash" | "upi" | "card", consent: boolean) =>
  rpc<Order>("biz_pay_order", { p_shop: shop, p_order: id, p_mode: mode, p_series: "A", p_consent: consent });
export const cancelOrder = (shop: string, id: string) => rpc("biz_cancel_order", { p_shop: shop, p_order: id });
export const startRedemption = (shop: string, id: string, points: number) =>
  rpc<{ request_id: string; points: number; discount: number }>("biz_start_redemption", { p_shop: shop, p_order: id, p_points: points });
export const applyRedemption = (shop: string, id: string, request: string | null) =>
  rpc<Order>("biz_use_redemption", { p_shop: shop, p_order: id, p_request: request });
