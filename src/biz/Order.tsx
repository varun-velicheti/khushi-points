import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { errorText, rpc } from "../lib";
import { useShop } from "../shop";
import { cancelOrder, getOrder, lineKey, openOrders, sameOpts, saveOrder, sendToKitchen, type Item, type Order } from "./api";
import { setCounter } from "./Floor";
import { useBiz } from "./BizApp";
import { rupees, totals, type Line } from "./money";

type Draft = Pick<Order, "id" | "kind" | "table_id" | "lines" | "customer_mobile" | "customer_member" | "customer_name" | "staff_id">;

// Take an order: tap items to add them; the order saves itself. Bill when done.
export default function OrderScreen() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { current } = useShop();
  const shopId = current!.shop.id;
  const { menu, reload, staff } = useBiz();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);           // exists in the database
  const [sent, setSent] = useState<Record<string, number>>({});   // what the kitchen already has
  const [sentNo, setSentNo] = useState<number | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ item: Item | null; line: number | null } | null>(null);   // options panel
  // without tables: other open orders are "held"; Hold parks this one and starts a fresh order
  const counter = menu.shop.use_tables === false;
  const [held, setHeld] = useState<Order[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  useEffect(() => {
    if (!counter) return;
    const load = () => openOrders(shopId, menu).then((all) => setHeld(all.filter((o) => o.id !== id && o.lines.length > 0)
      .sort((a, b) => b.opened_at.localeCompare(a.opened_at)))).catch(() => {});
    load(); const i = setInterval(load, 15000); return () => clearInterval(i);
  }, [counter, shopId, id, menu]);
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
      setOrder({ id: id!, kind: table ? "dine_in" : "takeaway", table_id: table, lines: [], customer_mobile: null, customer_member: null, customer_name: null, staff_id: staff?.id ?? null });
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

  // typing searches the whole menu; otherwise the chosen category
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return menu.items.filter((i) => (s ? i.name.toLowerCase().includes(s) : !cat || i.category_id === cat));
  }, [menu.items, cat, q]);
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
    const r = room(i.id);
    if (r !== null && r <= 0) return;
    if (i.options?.length) return setPick({ item: i, line: null });
    addLine({ item_id: i.id, name: i.name, price: Number(i.price), qty: 1, gst_rate: Number(i.gst_rate), hsn: i.hsn });
  }
  // the same dish with the same options and no note adds up on one line
  function addLine(n: Line) {
    const at = n.note ? -1 : order!.lines.findIndex((l) => l.item_id === n.item_id && !l.note && sameOpts(l.opts, n.opts));
    if (at >= 0) change(order!.lines.map((l, k) => (k === at ? { ...l, qty: l.qty + n.qty } : l)));
    else change([...order!.lines, n]);
  }
  const step = (k: number, d: number) => change(order.lines.flatMap((l, j) => (j !== k ? [l] : l.qty + d > 0 ? [{ ...l, qty: l.qty + d }] : [])));
  // how many more of this item can still be added (null: stock not counted)
  const room = (itemId?: string | null) => {
    const it = menu.items.find((x) => x.id === itemId);
    if (!it?.track_stock) return null;
    return Number(it.stock ?? 0) - order.lines.filter((l) => l.item_id === itemId).reduce((a, l) => a + l.qty, 0);
  };

  async function send() {
    try {
      await saveOrder(shopId, order!); dirty.current = false; setSaved(true);
      const k = await sendToKitchen(shopId, order!.id);
      const o = await getOrder(shopId, order!.id);
      setSent(o.sent ?? {}); setSentNo(k?.no ?? null); setErr("");
    } catch (e) { setErr(errorText(e)); }
  }
  // options panel result: a new line, or the edited line
  function picked(n: Line) {
    if (pick?.line == null) addLine(n);
    else change(order!.lines.map((x, j) => (j === pick.line ? n : x)));
    setPick(null);
  }
  async function bill() {
    try { await saveOrder(shopId, order!); dirty.current = false; navigate(`/biz/b/${order!.id}`); }
    catch (e) { setErr(errorText(e)); }
  }
  async function hold() {
    try {
      await saveOrder(shopId, order!); dirty.current = false;
      const next = crypto.randomUUID(); setCounter(shopId, next); navigate(`/biz/o/${next}`);
    } catch (e) { setErr(errorText(e)); }
  }
  async function resume(o: Order) {
    if (order!.lines.length && dirty.current) { await saveOrder(shopId, order!).catch(() => {}); dirty.current = false; }
    setShowHeld(false); setCounter(shopId, o.id); navigate(`/biz/o/${o.id}`);
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
        <input className="item-search" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu" />
        {items.map((i) => {
          const qty = order.lines.filter((l) => l.item_id === i.id).reduce((a, l) => a + l.qty, 0);
          const left = i.track_stock ? Number(i.stock ?? 0) - qty : null;
          const out = !i.available || (left !== null && left <= 0);     // nothing more can be added
          return (
            <button key={i.id} className={`item${out ? " out" : ""}`} onClick={() => (out && !soldOutMode ? undefined : tapItem(i))}>
              <span className={`dot ${i.veg ? "veg" : "nonveg"}`} aria-label={i.veg ? "Veg" : "Non-veg"} />
              <span className="item-name">{i.name}</span>
              <span className="item-price">{!i.available ? "Sold out" : left !== null && left <= 0 ? (qty ? "No more in stock" : "Out of stock") : rupees(i.price)}
                {left !== null && left > 0 && <small className={left <= Number(i.low_stock ?? 5) ? "low" : ""}>{left} left</small>}</span>
              {qty > 0 && <span className="item-qty">{qty}</span>}
            </button>
          );
        })}
      </section>

      <section className="cart">
        <header><b>{tableName ?? (counter ? "Order" : "Takeaway")}</b>
          {counter && held.length > 0 && <button className="btn link small" onClick={() => setShowHeld(true)}>Held · {held.length}</button>}
          <button className="btn link small" onClick={clear}>{saved ? "Cancel order" : "Close"}</button></header>
        <div className="cart-lines">
          {order.lines.map((l, k) => (
            <div className={`cart-line${!menu.shop.kitchen || (sent[lineKey(l)] ?? 0) >= l.qty ? " sent" : ""}`} key={k}>
              <button className="cart-name" onClick={() => setPick({ item: menu.items.find((x) => x.id === l.item_id) ?? null, line: k })}>
                {l.name}{l.opts?.length ? <small className="opts">{l.opts.join(", ")}</small> : null}{l.note && <small>{l.note}</small>}</button>
              <span className="stepper">
                <button onClick={() => step(k, -1)} aria-label={`One less ${l.name}`}>−</button>
                <b>{l.qty}</b>
                <button onClick={() => step(k, 1)} disabled={(room(l.item_id) ?? 1) <= 0} aria-label={`One more ${l.name}`}>+</button>
              </span>
              <span className="cart-amt">{rupees(l.price * l.qty)}</span>
            </div>
          ))}
        </div>
        {err && <div className="msg err">{err}</div>}
        <footer>
          <div className="cart-total"><span>{(() => { const n = order.lines.reduce((a, l) => a + l.qty, 0); return `${n} ${n === 1 ? "item" : "items"}`; })()}</span><b>{rupees(t.total)}</b></div>
          {counter ? <>
            {menu.shop.kitchen && <button className="btn alt" disabled={changes === 0} onClick={send}>{changes ? `Send to kitchen · ${changes}` : sentNo ? `Sent · #${sentNo}` : "Sent"}</button>}
            <div className="cart-actions hold-bill">
              <button className="btn alt" disabled={order.lines.length === 0} onClick={hold}>Hold</button>
              <button className="btn" disabled={order.lines.length === 0} onClick={bill}>Bill</button>
            </div>
          </> : menu.shop.kitchen ? (
            <div className="cart-actions">
              <button className="btn alt" disabled={changes === 0} onClick={send}>{changes ? `Send to kitchen · ${changes}` : sentNo ? `Sent · #${sentNo}` : "Sent"}</button>
              <button className="btn" disabled={order.lines.length === 0} onClick={bill}>Bill</button>
            </div>
          ) : <button className="btn" disabled={order.lines.length === 0} onClick={bill}>Bill</button>}
        </footer>
      </section>
      {showHeld && (
        <div className="sheet-bg" onClick={() => setShowHeld(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <header><b>Held orders</b><button type="button" className="btn link small" onClick={() => setShowHeld(false)}>Close</button></header>
            <div className="held-list">
              {held.map((o) => (
                <button key={o.id} className="held-row" onClick={() => resume(o)}>
                  <span><b>{rupees(o.total ?? totals(o.lines, menu.shop.gst_inclusive).total)}</b>
                    <small>{o.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</small></span>
                  <span className="hint">{Math.max(0, Math.round((Date.now() - new Date(o.opened_at).getTime()) / 60000))} min</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {pick && <Options item={pick.item} line={pick.line == null ? null : order.lines[pick.line]} room={pick.item ? room(pick.item.id) : null}
        onDone={picked} onClose={() => setPick(null)} />}
    </div>
  );
}

// Pick a size and add-ons, add a note. Editing a line starts from what it has.
function Options({ item, line, room, onDone, onClose }: {
  item: Item | null; line: Line | null; room: number | null; onDone: (l: Line) => void; onClose: () => void;
}) {
  const groups = item?.options ?? [];
  const base = Number(item?.price ?? 0);
  const [chosen, setChosen] = useState<string[][]>(() => groups.map((g) => {
    const had = g.choices.filter((c) => line?.opts?.includes(c.name)).map((c) => c.name);
    return had.length || g.pick === "many" ? had : [g.choices[0].name];
  }));
  const [note, setNote] = useState(line?.note ?? "");
  const [qty, setQty] = useState(line?.qty ?? 1);
  const extra = groups.reduce((a, g, gi) => a + g.choices.filter((c) => chosen[gi].includes(c.name)).reduce((s, c) => s + Number(c.price), 0), 0);
  // a line whose item left the menu keeps its price; only its note can change
  const price = item && groups.length ? base + extra : line?.price ?? base;
  const max = room === null ? 999 : room + (line?.qty ?? 0);
  const toggle = (gi: number, name: string) => setChosen(chosen.map((c, i) => (i !== gi ? c
    : groups[gi].pick === "one" ? [name] : c.includes(name) ? c.filter((x) => x !== name) : [...c, name])));
  function done() {
    const opts = groups.flatMap((g, gi) => g.choices.filter((c) => chosen[gi].includes(c.name)).map((c) => c.name));
    const from = line ?? { item_id: item!.id, name: item!.name, gst_rate: Number(item!.gst_rate), hsn: item!.hsn, price, qty };
    onDone({ ...from, price, qty, note: note.trim() || null, opts: groups.length ? (opts.length ? opts : null) : line?.opts ?? null });
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); done(); }}>
        <header><b>{item?.name ?? line?.name}</b><button type="button" className="btn link small" onClick={onClose}>Close</button></header>
        {groups.map((g, gi) => (
          <fieldset key={gi} className="opt-group">
            <legend>{g.name}</legend>
            <div className="opt-choices">
              {g.choices.map((c) => (
                <button type="button" key={c.name} aria-pressed={chosen[gi].includes(c.name)} onClick={() => toggle(gi, c.name)}>
                  {c.name}{Number(c.price) > 0 && <small>+{rupees(c.price)}</small>}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <input placeholder="Note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} aria-label="Note for the kitchen" />
        <footer>
          <span className="stepper">
            <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="One less">−</button>
            <b>{qty}</b>
            <button type="button" onClick={() => setQty(qty + 1)} disabled={qty >= max} aria-label="One more">+</button>
          </span>
          <button className="btn" type="submit" disabled={qty > max}>{line ? "Update" : "Add"} · {rupees(price * qty)}</button>
        </footer>
      </form>
    </div>
  );
}
