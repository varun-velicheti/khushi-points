import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { errorText, rpc, supabase } from "../lib";
import { useShop } from "../shop";
import { CustomerPicker, RewardsDue, type Balance, type Who } from "../pages/Counter";
import { applyRedemption, getOrder, payOrder, preview, saveOrder, startRedemption, type BizShop, type Order, type Payment } from "./api";
import { ModeButtons, RefundSheet, SplitPay, UpiQr } from "./Pay";
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
  const { menu, reload } = useBiz();
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
  const [split, setSplit] = useState(false);

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

  if (order.status === "paid" || order.status === "void") return <Paid order={order} tot={tot} shop={menu.shop} table={table} onChange={setOrder} />;

  const pv = Number(menu.shop.point_value);
  const cap = Math.floor((tot.total * menu.shop.max_redeem_pct) / 100 / pv);
  const usable = Math.min(info?.balance ?? 0, cap);
  const canRedeem = !!who && !!info?.exists && !!info.has_app && usable >= menu.shop.min_redeem && !order.redeem_request_id && !waiting;
  const n = Math.floor(Number(pts || usable));
  const nOk = n >= menu.shop.min_redeem && n <= usable;
  const needsConsent = !!who?.mobile && info?.exists === false && !info?.has_app;
  const blocked = !!waiting || (needsConsent && !consent && !!who);

  async function usePoints() {
    setErr(""); setNote("");
    try {
      const r = await startRedemption(shop.id, order!.id, n);
      supabase.functions.invoke("push", { body: { action: "redeem", shop_id: shop.id, request_id: r.request_id } }).catch(() => {});
      setWaiting(r.request_id);
    } catch (e) { setErr(errorText(e)); }
  }
  async function pay(parts?: Payment[]) {
    setBusy(true); setErr("");
    try {
      const o = await payOrder(shop.id, menu, order!.id, parts?.[0]?.mode ?? mode, consent, parts);
      reload().catch(() => {});   // fresh stock counts
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

        {split ? (
          <SplitPay total={tot.total} discount={tot.discount} lines={order.lines} inclusive={menu.shop.gst_inclusive} shop={menu.shop}
            note={order.id.slice(0, 8)} busy={busy} blocked={blocked} onPay={pay} onCancel={() => setSplit(false)} />
        ) : <>
          <ModeButtons mode={mode} onChange={setMode} />
          {mode === "upi" && <UpiQr shop={menu.shop} amount={tot.total} note={order.id.slice(0, 8)} />}
          <button className="btn pay" disabled={busy || blocked} onClick={() => pay()}>
            {busy ? "…" : `Paid ${rupees(tot.total)}`}
          </button>
          {tot.total > 0 && <button className="btn link small" onClick={() => setSplit(true)}>Split bill</button>}
        </>}
        {err && <div className="msg err">{err}</div>}
        <button className="btn link small" onClick={() => navigate(`/biz/o/${order.id}`)}>Edit order</button>
      </section>
    </div>
  );
}

function Paid({ order, tot, shop, table, onChange }: { order: Order; tot: Totals; shop: BizShop; table: string | null; onChange: (o: Order) => void }) {
  const navigate = useNavigate();
  const { owner, staffOn, askManager } = useBiz();
  const canManage = owner || staffOn;
  const { current } = useShop();
  const [err, setErr] = useState("");
  const [refunding, setRefunding] = useState(false);
  const isVoid = order.status === "void";
  const refunded = (order.refunds ?? []).reduce((a, r) => a + Number(r.totals.total), 0);
  const canRefund = (order.refunds ?? []).reduce((a, r) => a + r.lines.reduce((s, l) => s + l.qty, 0), 0) < order.lines.reduce((a, l) => a + l.qty, 0);
  async function voidBill() {
    const reason = window.prompt(`Void ${order.invoice_no}? Points from this bill are taken back and stock is returned.\n\nReason`, "");
    if (reason === null) return;
    const approval = await askManager();
    if (approval === undefined) return;
    try { onChange(await rpc<Order>("biz_void_order", { p_shop: current!.shop.id, p_order: order.id, p_reason: reason, ...(approval ? { p_approval: approval } : {}) })); }
    catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="bill">
      <Invoice order={order} tot={tot} shop={shop} table={table} />
      <section className="bill-side done">
        {isVoid ? <div className="void-banner">Void{order.void_reason ? ` · ${order.void_reason}` : ""}</div> : <div className="done-mark">✓</div>}
        <h2>{rupees(tot.total)} {isVoid ? "voided" : "paid"}</h2>
        <p className="mono">{order.invoice_no}</p>
        {refunded > 0 && <div className="msg info">{rupees(refunded)} refunded</div>}
        {!isVoid && order.points_earned ? <div className="msg ok">+{order.points_earned} points</div> : null}
        {order.points_error ? <div className="msg info">{errorText(order.points_error)}</div> : null}
        {err && <div className="msg err">{err}</div>}
        <button className="btn" onClick={() => navigate("/biz")}>Next order</button>
        <button className="btn alt" onClick={() => window.print()}>Print</button>
        <button className="btn link small" onClick={() => navigate("/biz/bills")}>All bills</button>
        {canManage && !isVoid && canRefund && <button className="btn link small" onClick={() => setRefunding(true)}>Refund items</button>}
        {canManage && !isVoid && <button className="btn link small del" onClick={voidBill}>Void bill</button>}
      </section>
      {refunding && <RefundSheet order={order} shopId={current!.shop.id} inclusive={shop.gst_inclusive}
        onDone={(o) => { onChange(o); setRefunding(false); }} onClose={() => setRefunding(false)} />}
    </div>
  );
}

// The GST invoice, as shown on screen and printed.
export function Invoice({ order, tot, shop, table }: { order: Order; tot: Totals; shop: BizShop; table: string | null }) {
  const paid = order.status === "paid" || order.status === "void";
  const date = new Date(order.paid_at ?? order.opened_at);
  return (
    <article className="invoice">
      <header>
        <b>{shop.legal_name ?? shop.name}</b>
        {shop.address && <span>{shop.address}</span>}
        {shop.gstin && <span>GSTIN {shop.gstin}</span>}
      </header>
      <div className="inv-meta">
        <span>{order.status === "void" ? `VOID ${order.invoice_no}` : paid ? `Tax invoice ${order.invoice_no}` : "Bill"}</span>
        <span>{date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        <span>{table ?? "Takeaway"}</span>
      </div>
      <table className="inv-lines">
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}><td>{l.name}{l.opts?.length ? <small>{l.opts.join(", ")}</small> : null}<small>{l.qty} × {paise(l.price)}</small></td><td>{paise(l.price * l.qty)}</td></tr>
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
      {order.staff && <footer>Billed by {order.staff}</footer>}
      {paid && order.payments?.[0] && <footer>Paid by {order.payments.length > 1
        ? order.payments.map((p) => `${p.mode.toUpperCase()} ${paise(p.amount)}`).join(" · ") : order.payments[0].mode.toUpperCase()}</footer>}
      {(order.refunds ?? []).map((r) => (
        <section className="credit" key={r.id}>
          <div className="inv-meta"><span>Credit note {r.credit_no}</span>
            <span>{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span></div>
          {r.lines.map((l, k) => <div className="credit-line" key={k}><span>{l.qty} × {l.name}</span><span>−{paise(l.price * l.qty)}</span></div>)}
          <div className="credit-line"><b>Refunded by {r.mode.toUpperCase()}{r.reason ? ` · ${r.reason}` : ""}</b><b>−{rupees(r.totals.total)}</b></div>
          {r.points_back ? <div className="credit-line"><span>Points taken back</span><span>−{r.points_back}</span></div> : null}
        </section>
      ))}
    </article>
  );
}
