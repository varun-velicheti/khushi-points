import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { errorText, rpc, supabase } from "../lib";
import { useShop } from "../shop";
import { CustomerPicker, RewardsDue, type Balance, type Who } from "../pages/Counter";
import { applyRedemption, getOrder, payOrder, preview, saveOrder, startRedemption, type BizShop, type Order } from "./api";
import { useBiz } from "./BizApp";
import { paise, rupees, type Totals } from "./money";

type Mode = "cash" | "upi" | "card";
// CGST is half the GST rounded to the paisa; SGST is the rest (same as the totals).
const half = (tax: number) => Math.round((tax / 2 + Number.EPSILON) * 100) / 100;

// Bill: GST invoice, customer (points), payment. Paid closes the order.
export default function BillScreen() {
  const { id } = useParams<{ id: string }>();
  const { current } = useShop();
  const shop = current!.shop;
  const { menu } = useBiz();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [tot, setTot] = useState<Totals | null>(null);
  const [raw, setRaw] = useState("");
  const [who, setWho] = useState<Who | null>(null);
  const [info, setInfo] = useState<Balance | null>(null);
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<Mode>("upi");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [waiting, setWaiting] = useState<string | null>(null);   // redemption request waiting for the customer's approval
  const [pts, setPts] = useState("");                            // points to use
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const o = await getOrder(shop.id, id!);
    setOrder(o);
    setTot(o.status === "paid" ? o.totals : await preview(shop.id, id!, menu));
    return o;
  }, [shop.id, id, menu]);
  useEffect(() => {
    refresh().then(async (o) => {
      setRaw(o.customer_member ?? o.customer_mobile ?? "");
      // a points request still waiting (e.g. the page was reloaded): keep waiting for it
      if (o.status === "open" && o.redeem_request_id && (await preview(shop.id, o.id, menu)).discount === 0) setWaiting(o.redeem_request_id);
    }).catch((e) => setErr(errorText(e)));
  }, [refresh, shop.id]);

  // keep the customer on the order
  const onLookup = useCallback((w: Who | null, b: Balance | null) => { setWho(w); setInfo(b); }, []);
  useEffect(() => {
    if (!order || order.status !== "open") return;
    const mobile = who?.mobile ?? null, member = who?.member ?? null;
    if (mobile === order.customer_mobile && member === order.customer_member) return;
    saveOrder(shop.id, { ...order, customer_mobile: mobile, customer_member: member }).then(setOrder).catch((e) => setErr(errorText(e)));
  }, [who]); // eslint-disable-line react-hooks/exhaustive-deps

  // wait for the customer to approve points in their app
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const st = await rpc<{ status: string; error?: string }>("redemption_status", { p_shop: shop.id, p_request: waiting }).catch(() => null);
      if (!st || st.status === "pending") return;
      setWaiting(null);
      if (st.status !== "done") {
        await applyRedemption(shop.id, id!, null).catch(() => {});
        setErr(st.status === "declined" ? "The customer declined." : st.status === "expired" ? "No answer from the customer." : errorText(st.error ?? st.status));
      }
      refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [waiting, shop.id, id, refresh]);

  if (!order || !tot) return <div className="biz-pad">{err ? <div className="msg err">{err}</div> : <span className="hint">Loading…</span>}</div>;
  const table = menu.tables.find((x) => x.id === order.table_id)?.name ?? null;

  if (order.status === "paid") return <Paid order={order} tot={tot} shop={menu.shop} table={table} />;

  const pv = Number(menu.shop.point_value);
  const cap = Math.floor((tot.total * menu.shop.max_redeem_pct) / 100 / pv);
  const usable = Math.min(info?.balance ?? 0, cap);
  const canRedeem = !!who && !!info?.exists && !!info.has_app && usable >= menu.shop.min_redeem && !order.redeem_request_id && !waiting;
  const n = Math.floor(Number(pts || usable));
  const nOk = n >= menu.shop.min_redeem && n <= usable;
  const needsConsent = !!who?.mobile && info?.exists === false && !info?.has_app;

  async function usePoints() {
    setErr(""); setNote("");
    try {
      const r = await startRedemption(shop.id, order!.id, n);
      supabase.functions.invoke("push", { body: { action: "redeem", shop_id: shop.id, request_id: r.request_id } }).catch(() => {});
      setWaiting(r.request_id);
    } catch (e) { setErr(errorText(e)); }
  }
  async function pay() {
    setBusy(true); setErr("");
    try {
      const o = await payOrder(shop.id, menu, order!.id, mode, consent);
      setOrder(o); setTot(o.totals);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="bill">
      <Invoice order={order} tot={tot} shop={menu.shop} table={table} />
      <section className="bill-side">
        <CustomerPicker id="bill-who" value={raw} onChange={setRaw} shop={shop} onLookup={onLookup} />
        {who && info?.exists && <div className="who"><span>{info.name ?? "Customer"}</span><b>{info.balance} pts</b></div>}
        {needsConsent && (
          <label className="check" htmlFor="bill-consent">
            <input id="bill-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Customer agrees to save their number for points</span>
          </label>
        )}
        {who && info?.exists && <RewardsDue shop={shop} who={who} />}
        {canRedeem && (
          <div className="redeem">
            <input aria-label="Points to use" inputMode="numeric" value={pts} placeholder={String(usable)}
              onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} />
            <button className="btn alt" disabled={!nOk} onClick={usePoints}>Use points (−{rupees((nOk ? n : 0) * pv)})</button>
          </div>
        )}
        {waiting && <div className="msg info"><strong>Waiting for approval in the app</strong>
          <button className="btn link small" onClick={async () => { setWaiting(null); await applyRedemption(shop.id, order.id, null).catch(() => {}); refresh(); }}>Cancel</button></div>}
        {order.redeem_request_id && !waiting && tot.discount > 0 && (
          <button className="btn link small" onClick={async () => {
            await applyRedemption(shop.id, order.id, null).catch((e) => setErr(errorText(e)));
            setNote(`${Math.round(tot.discount / pv)} points returned to the customer`); setPts(""); refresh();
          }}>Remove points discount</button>
        )}
        {note && <div className="msg ok">{note}</div>}

        <div className="pay-modes" role="group" aria-label="Payment">
          {(["upi", "cash", "card"] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "upi" ? "UPI" : m === "cash" ? "Cash" : "Card"}</button>
          ))}
        </div>
        {mode === "upi" && <UpiQr shop={menu.shop} amount={tot.total} note={order.id.slice(0, 8)} />}
        {err && <div className="msg err">{err}</div>}
        <button className="btn pay" disabled={busy || !!waiting || (needsConsent && !consent && !!who)} onClick={pay}>
          {busy ? "…" : `Paid ${rupees(tot.total)}`}
        </button>
        <button className="btn link small" onClick={() => navigate(`/biz/o/${order.id}`)}>Edit order</button>
      </section>
    </div>
  );
}

function UpiQr({ shop, amount, note }: { shop: BizShop; amount: number; note: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!shop.upi_id || amount <= 0) return setSrc("");
    const url = `upi://pay?pa=${encodeURIComponent(shop.upi_id)}&pn=${encodeURIComponent(shop.legal_name ?? shop.name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    QRCode.toDataURL(url, { margin: 1, width: 360 }).then(setSrc).catch(() => setSrc(""));
  }, [shop.upi_id, shop.legal_name, shop.name, amount, note]);
  if (!shop.upi_id) return null;
  return src ? <figure className="upi"><img src={src} alt={`UPI QR for ${rupees(amount)}`} /><figcaption>{shop.upi_id}</figcaption></figure> : null;
}

function Paid({ order, tot, shop, table }: { order: Order; tot: Totals; shop: BizShop; table: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="bill">
      <Invoice order={order} tot={tot} shop={shop} table={table} />
      <section className="bill-side done">
        <div className="done-mark">✓</div>
        <h2>{rupees(tot.total)} paid</h2>
        <p className="mono">{order.invoice_no}</p>
        {order.points_earned ? <div className="msg ok">+{order.points_earned} points</div> : null}
        {order.points_error ? <div className="msg info">{errorText(order.points_error)}</div> : null}
        <button className="btn" onClick={() => navigate("/biz")}>Next order</button>
        <button className="btn alt" onClick={() => window.print()}>Print</button>
      </section>
    </div>
  );
}

// The GST invoice, as shown on screen and printed.
export function Invoice({ order, tot, shop, table }: { order: Order; tot: Totals; shop: BizShop; table: string | null }) {
  const paid = order.status === "paid";
  const date = new Date(order.paid_at ?? order.opened_at);
  return (
    <article className="invoice">
      <header>
        <b>{shop.legal_name ?? shop.name}</b>
        {shop.address && <span>{shop.address}</span>}
        {shop.gstin && <span>GSTIN {shop.gstin}</span>}
      </header>
      <div className="inv-meta">
        <span>{paid ? `Tax invoice ${order.invoice_no}` : "Bill"}</span>
        <span>{date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        <span>{table ?? "Takeaway"}</span>
      </div>
      <table className="inv-lines">
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}><td>{l.name}<small>{l.qty} × {paise(l.price)}</small></td><td>{paise(l.price * l.qty)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="inv-tot">
        {tot.discount > 0 && <><dt>Points</dt><dd>−{paise(tot.discount)}</dd></>}
        <dt>Taxable</dt><dd>{paise(tot.taxable)}</dd>
        <dt>CGST</dt><dd>{paise(tot.cgst)}</dd>
        <dt>SGST</dt><dd>{paise(tot.sgst)}</dd>
        {tot.round_off !== 0 && <><dt>Round off</dt><dd>{paise(tot.round_off)}</dd></>}
        <dt className="grand">Total</dt><dd className="grand">{rupees(tot.total)}</dd>
      </dl>
      {tot.by_rate.length > 0 && (
        <table className="inv-gst">
          <thead><tr><th>GST</th><th>Taxable</th><th>CGST</th><th>SGST</th></tr></thead>
          <tbody>{tot.by_rate.map((r) => (
            <tr key={r.rate}><td>{r.rate}%</td><td>{paise(r.taxable)}</td><td>{paise(half(r.tax))}</td><td>{paise(r.tax - half(r.tax))}</td></tr>
          ))}</tbody>
        </table>
      )}
      {paid && order.payments?.[0] && <footer>Paid by {order.payments[0].mode.toUpperCase()}</footer>}
    </article>
  );
}
