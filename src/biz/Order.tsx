import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { errorText, rpc } from "../lib";
import { useShop } from "../shop";
import { cancelOrder, getOrder, lineKey, saveOrder, sendToKitchen, type Item, type Order } from "./api";
import { useBiz } from "./BizApp";
import { rupees, totals, type Line } from "./money";

type Draft = Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name">;

// Take an order: tap items to add them; the order saves itself. Bill when done.
export default function OrderScreen() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { current } = useShop();
  const shopId = current!.shop.id;
  const { menu, reload } = useBiz();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);           // exists in the database
  const [sent, setSent] = useState<Record<string, number>>({});   // what the kitchen already has
  const [sentNo, setSentNo] = useState<number | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [err, setErr] = useState("");
  const dirty = useRef(false);

  // load the order, or start a new one
  useEffect(() => {
    let stale = false;
    getOrder(shopId, id!).then((o) => {
      if (stale) return;
      if (o.status === "paid") return navigate(`/biz/b/${o.id}`, { replace: true });
      if (o.status !== "open") return navigate("/biz", { replace: true });
      setOrder(o); setSaved(true); setSent(o.sent ?? {});
    }).catch(() => {
      if (stale) return;
      const table = params.get("table");
      setOrder({ id: id!, kind: table ? "dine_in" : "takeaway", table_id: table, lines: [], customer_mobile: null, customer_member: null, customer_name: null });
    });
    return () => { stale = true; };
  }, [shopId, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // save shortly after each change
  useEffect(() => {
    if (!order || !dirty.current) return;
    if (!saved && order.lines.length === 0) return;
    const t = setTimeout(() => {
      saveOrder(shopId, order).then(() => { setSaved(true); setErr(""); dirty.current = false; })
        .catch((e) => setErr(errorText(e)));
    }, 400);
    return () => clearTimeout(t);
  }, [order, saved, shopId]);

  const items = useMemo(() => menu.items.filter((i) => !cat || i.category_id === cat), [menu.items, cat]);
  const t = totals(order?.lines ?? [], menu.shop.gst_inclusive);
  const tableName = menu.tables.find((x) => x.id === order?.table_id)?.name;

  if (!order) return <div className="biz-pad hint">Loading…</div>;

  // what changed since the last send: per dish, now minus already sent (removed dishes count too)
  const now: Record<string, number> = {};
  order.lines.forEach((l) => { now[lineKey(l)] = (now[lineKey(l)] ?? 0) + l.qty; });
  const changes = [...new Set([...Object.keys(now), ...Object.keys(sent)])].reduce((a, k) => a + Math.abs((now[k] ?? 0) - (sent[k] ?? 0)), 0);

  const change = (lines: Line[]) => { dirty.current = true; setOrder({ ...order, lines }); };
  async function tapItem(i: Item) {
    if (soldOutMode) {
      await rpc("biz_set_available", { p_shop: shopId, p_id: i.id, p_available: !i.available }).catch((e) => setErr(errorText(e)));
      return reload();
    }
    if (!i.available) return;
    const at = order!.lines.findIndex((l) => l.item_id === i.id && !l.note);
    if (at >= 0) change(order!.lines.map((l, k) => (k === at ? { ...l, qty: l.qty + 1 } : l)));
    else change([...order!.lines, { item_id: i.id, name: i.name, price: Number(i.price), qty: 1, gst_rate: Number(i.gst_rate), hsn: i.hsn }]);
  }
  const step = (k: number, d: number) => change(order.lines.flatMap((l, j) => (j !== k ? [l] : l.qty + d > 0 ? [{ ...l, qty: l.qty + d }] : [])));

  async function send() {
    try {
      await saveOrder(shopId, order!); dirty.current = false; setSaved(true);
      const k = await sendToKitchen(shopId, order!.id);
      const o = await getOrder(shopId, order!.id);
      setSent(o.sent ?? {}); setSentNo(k?.no ?? null); setErr("");
    } catch (e) { setErr(errorText(e)); }
  }
  function noteFor(k: number) {
    const l = order!.lines[k];
    const n = window.prompt(`Note for ${l.name}`, l.note ?? "");
    if (n === null) return;
    change(order!.lines.map((x, j) => (j === k ? { ...x, note: n.trim() || null } : x)));
  }
  async function bill() {
    try { await saveOrder(shopId, order!); dirty.current = false; navigate(`/biz/b/${order!.id}`); }
    catch (e) { setErr(errorText(e)); }
  }
  async function clear() {
    if (saved && !window.confirm("Cancel this order?")) return;
    if (saved) await cancelOrder(shopId, order!.id).catch(() => {});
    navigate("/biz");
  }

  return (
    <div className="order">
      <aside className="cats">
        <button aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
        {menu.categories.map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
        <button className={`cats-soldout${soldOutMode ? " on" : ""}`} onClick={() => setSoldOutMode(!soldOutMode)}>{soldOutMode ? "Done" : "Sold out…"}</button>
      </aside>

      <section className={`items${soldOutMode ? " editing" : ""}`}>
        {items.map((i) => {
          const qty = order.lines.filter((l) => l.item_id === i.id).reduce((a, l) => a + l.qty, 0);
          return (
            <button key={i.id} className={`item${i.available ? "" : " out"}`} onClick={() => tapItem(i)}>
              <span className={`dot ${i.veg ? "veg" : "nonveg"}`} aria-label={i.veg ? "Veg" : "Non-veg"} />
              <span className="item-name">{i.name}</span>
              <span className="item-price">{i.available ? rupees(i.price) : "Sold out"}</span>
              {qty > 0 && <span className="item-qty">{qty}</span>}
            </button>
          );
        })}
      </section>

      <section className="cart">
        <header><b>{tableName ?? "Takeaway"}</b><button className="btn link small" onClick={clear}>{saved ? "Cancel order" : "Close"}</button></header>
        <div className="cart-lines">
          {order.lines.map((l, k) => (
            <div className={`cart-line${(sent[lineKey(l)] ?? 0) >= l.qty ? " sent" : ""}`} key={k}>
              <button className="cart-name" onClick={() => noteFor(k)}>{l.name}{l.note && <small>{l.note}</small>}</button>
              <span className="stepper">
                <button onClick={() => step(k, -1)} aria-label={`One less ${l.name}`}>−</button>
                <b>{l.qty}</b>
                <button onClick={() => step(k, 1)} aria-label={`One more ${l.name}`}>+</button>
              </span>
              <span className="cart-amt">{rupees(l.price * l.qty)}</span>
            </div>
          ))}
        </div>
        {err && <div className="msg err">{err}</div>}
        <footer>
          <div className="cart-total"><span>{order.lines.reduce((a, l) => a + l.qty, 0)} items</span><b>{rupees(t.total)}</b></div>
          <div className="cart-actions">
            <button className="btn alt" disabled={changes === 0} onClick={send}>{changes ? `Send to kitchen · ${changes}` : sentNo ? `Sent · #${sentNo}` : "Sent"}</button>
            <button className="btn" disabled={order.lines.length === 0} onClick={bill}>Bill</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
