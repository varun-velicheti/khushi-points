// Offline for Khushi Biz: the device keeps the menu, open orders and a queue of changes ("outbox").
// Every change is stored here first, then sent to the server in order. Without internet the queue waits;
// when the connection is back it is sent. Saving and paying are safe to repeat on the server, so a
// change sent twice does no harm. Each device numbers its own invoices (series A, B, ...).
import { rpc, supabase } from "../lib";
import type { Menu, Order } from "./api";
import { totals } from "./money";

type Draft = Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name">;
type Op =
  | { kind: "save"; shop: string; order: Draft }
  | { kind: "pay"; shop: string; id: string; mode: string; consent: boolean; series: string; seq: number; paid_at: string }
  | { kind: "cancel"; shop: string; id: string };
type Device = { series: string; fy: string; last: number };
export type SyncState = { online: boolean; waiting: number; failed: string[] };

// ---------------------------------------------------------------- storage

const key = (shop: string, name: string) => `kb:${shop}:${name}`;
function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

const OUTBOX = "kb:outbox";
const outbox = () => read<Op[]>(OUTBOX, []);
const setOutbox = (ops: Op[]) => { write(OUTBOX, ops); emit(); };
const localOrders = (shop: string) => read<Record<string, Order>>(key(shop, "orders"), {});
const setLocalOrders = (shop: string, o: Record<string, Order>) => write(key(shop, "orders"), o);
const pendingIds = (shop: string) => new Set(outbox().filter((op) => op.shop === shop).map((op) => (op.kind === "save" ? op.order.id : op.id)));

export const cachedMenu = (shop: string) => read<Menu | null>(key(shop, "menu"), null);
export const cacheMenu = (shop: string, m: Menu) => write(key(shop, "menu"), m);

// ---------------------------------------------------------------- status

let failed: string[] = [];
let offline = typeof navigator !== "undefined" && !navigator.onLine;
const listeners = new Set<(s: SyncState) => void>();
const state = (): SyncState => ({ online: !offline, waiting: outbox().length, failed });
function emit() { const s = state(); listeners.forEach((f) => f(s)); }
export function onSync(f: (s: SyncState) => void) { listeners.add(f); f(state()); return () => { listeners.delete(f); }; }

export const isNetworkError = (e: unknown) =>
  !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test((e as Error)?.message ?? String(e));

// ---------------------------------------------------------------- invoice series for this device

function fyOf(d: Date, tz: string) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "2-digit", month: "numeric" }).format(d).split("-").map(Number);
  return m >= 4 ? `${y}${y + 1}` : `${y - 1}${y}`;
}

// Claims (or re-claims) this device's series and catches up with the server's last number.
export async function claimDevice(shop: string) {
  const mine = read<Device | null>(key(shop, "device"), null);
  const r = await rpc<Device>("biz_claim_series", { p_shop: shop, p_name: navigator.userAgent.slice(0, 40), p_series: mine?.series ?? null });
  write(key(shop, "device"), { series: r.series, fy: r.fy, last: Math.max(r.last, mine?.series === r.series && mine.fy === r.fy ? mine.last : 0) });
}
function nextInvoice(shop: string, tz: string, at: Date) {
  const d = read<Device | null>(key(shop, "device"), null);
  if (!d) throw new Error("NO_DEVICE_SERIES");
  const fy = fyOf(at, tz);
  const seq = (d.fy === fy ? d.last : 0) + 1;
  write(key(shop, "device"), { ...d, fy, last: seq });
  return { series: d.series, seq, invoice_no: `${d.series}${fy}-${String(seq).padStart(4, "0")}` };
}

// ---------------------------------------------------------------- orders

export function saveLocal(shop: string, draft: Draft): Order {
  const all = localOrders(shop);
  const prev = all[draft.id];
  const o: Order = { ...(prev ?? { status: "open", opened_at: new Date().toISOString(), redeem_request_id: null, paid_at: null, invoice_no: null,
    totals: null, payments: null, points_earned: null, points_error: null }), ...draft, updated_at: new Date().toISOString() } as Order;
  all[draft.id] = o; setLocalOrders(shop, all);
  // only the latest save of an order needs sending
  setOutbox([...outbox().filter((op) => !(op.kind === "save" && op.order.id === draft.id)), { kind: "save", shop, order: draft }]);
  void flush();
  return o;
}

export function payLocal(shop: string, menu: Menu, id: string, mode: "cash" | "upi" | "card", consent: boolean): Order {
  const all = localOrders(shop);
  const o = all[id];
  if (!o) throw new Error("NOT_FOUND");
  if (o.status === "paid") return o;
  const at = new Date();
  const inv = nextInvoice(shop, menu.shop.timezone, at);
  const t = totals(o.lines, menu.shop.gst_inclusive);
  const paid: Order = { ...o, status: "paid", paid_at: at.toISOString(), invoice_no: inv.invoice_no, totals: t,
    payments: [{ mode, amount: t.total }], points_earned: null, points_error: null };
  all[id] = paid; setLocalOrders(shop, all);
  setOutbox([...outbox(), { kind: "pay", shop, id, mode, consent, series: inv.series, seq: inv.seq, paid_at: paid.paid_at! }]);
  void flush();
  return paid;
}

export function cancelLocal(shop: string, id: string) {
  const all = localOrders(shop);
  if (all[id]) { all[id] = { ...all[id], status: "cancelled" }; setLocalOrders(shop, all); }
  setOutbox([...outbox(), { kind: "cancel", shop, id }]);
  void flush();
}

export function getLocal(shop: string, id: string): Order | null { return localOrders(shop)[id] ?? null; }
export const hasPending = (shop: string, id: string) => pendingIds(shop).has(id);

// Server list merged with what this device has not sent yet. Offline: the device's own list.
export function mergeOpen(shop: string, server: Order[] | null, menu: Menu): Order[] {
  const all = localOrders(shop);
  const pending = pendingIds(shop);
  if (server) {
    for (const o of server) if (!pending.has(o.id)) all[o.id] = o;
    // open here but not on the server and nothing waiting: closed on another device
    for (const id of Object.keys(all)) if (all[id].status === "open" && !pending.has(id) && !server.some((o) => o.id === id)) delete all[id];
    // forget paid orders that are sent and older than a day
    for (const id of Object.keys(all)) if (all[id].status !== "open" && !pending.has(id) && Date.now() - new Date(all[id].updated_at).getTime() > 864e5) delete all[id];
    setLocalOrders(shop, all);
  }
  return Object.values(all).filter((o) => o.status === "open")
    .map((o) => ({ ...o, total: o.total ?? totals(o.lines, menu.shop.gst_inclusive).total }))
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at));
}

export function remember(shop: string, o: Order) { const all = localOrders(shop); all[o.id] = o; setLocalOrders(shop, all); }

// ---------------------------------------------------------------- sending the queue

let flushing: Promise<void> | null = null;
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (let op = outbox()[0]; op; op = outbox()[0]) {
      try {
        if (op.kind === "save") {
          try { await rpc("biz_save_order", { p_shop: op.shop, p: op.order }); }
          catch (e) {
            const m = (e as Error).message;
            if (/TABLE_BUSY/.test(m)) await rpc("biz_save_order", { p_shop: op.shop, p: { ...op.order, table_id: null } });   // keep the bill, drop the table
            else if (!/ORDER_CLOSED/.test(m)) throw e;
          }
        } else if (op.kind === "cancel") {
          await rpc("biz_cancel_order", { p_shop: op.shop, p_order: op.id });
        } else {
          let r: Order;
          try {
            r = await rpc<Order>("biz_pay_order", { p_shop: op.shop, p_order: op.id, p_mode: op.mode, p_series: op.series,
              p_consent: op.consent, p_seq: op.seq, p_paid_at: op.paid_at });
          } catch (e) {
            if (!/INVOICE_TAKEN/.test((e as Error).message)) throw e;
            await claimDevice(op.shop);   // number used elsewhere: catch up and take the next one
            const d = read<Device>(key(op.shop, "device"), { series: op.series, fy: "", last: op.seq });
            write(key(op.shop, "device"), { ...d, last: d.last + 1 });
            r = await rpc<Order>("biz_pay_order", { p_shop: op.shop, p_order: op.id, p_mode: op.mode, p_series: d.series,
              p_consent: op.consent, p_seq: d.last + 1, p_paid_at: op.paid_at });
          }
          remember(op.shop, r);
          if (r.txn_id) supabase.functions.invoke("push", { body: { action: "earn", shop_id: op.shop, txn_id: r.txn_id } }).catch(() => {});
        }
        offline = false;
        setOutbox(outbox().slice(1));
      } catch (e) {
        if (isNetworkError(e)) { offline = true; emit(); return; }
        failed = [...failed, `${op.kind === "pay" ? "Payment" : "Order"}: ${(e as Error).message}`].slice(-5);
        setOutbox(outbox().slice(1));
      }
    }
    offline = false; emit();
  })().finally(() => { flushing = null; });
  return flushing;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { offline = false; void flush(); });
  window.addEventListener("offline", () => { offline = true; emit(); });
  setInterval(() => { if (outbox().length) void flush(); }, 15000);
}
