import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { errorText } from "../lib";
import { refundOrder, type BizShop, type Order, type Payment } from "./api";
import { useBiz } from "./BizApp";
import { rupees, totals, type Line } from "./money";

type Mode = Payment["mode"];
const MODES: [Mode, string][] = [["upi", "UPI"], ["cash", "Cash"], ["card", "Card"]];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const gross = (l: Line, inclusive: boolean) => l.price * l.qty * (inclusive ? 1 : 1 + l.gst_rate / 100);

export function ModeButtons({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="pay-modes" role="group" aria-label="Payment">
      {MODES.map(([m, label]) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}>{label}</button>)}
    </div>
  );
}

export function UpiQr({ shop, amount, note }: { shop: BizShop; amount: number; note: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!shop.upi_id || amount <= 0) return setSrc("");
    const url = `upi://pay?pa=${encodeURIComponent(shop.upi_id)}&pn=${encodeURIComponent(shop.legal_name ?? shop.name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    QRCode.toDataURL(url, { margin: 1, width: 360 }).then(setSrc).catch(() => setSrc(""));
  }, [shop.upi_id, shop.legal_name, shop.name, amount, note]);
  if (!shop.upi_id) return null;
  return src ? <figure className="upi"><img src={src} alt={`UPI QR for ${rupees(amount)}`} /><figcaption>{shop.upi_id}</figcaption></figure> : null;
}

// One bill, paid in parts: evenly, by item (tick what this person had) or any amount. Paid when nothing is left.
export function SplitPay({ total, discount, lines, inclusive, shop, note, busy, blocked, onPay, onCancel }: {
  total: number; discount: number; lines: Line[]; inclusive: boolean; shop: BizShop; note: string;
  busy: boolean; blocked: boolean; onPay: (parts: Payment[]) => void; onCancel: () => void;
}) {
  const [parts, setParts] = useState<Payment[]>([]);
  const [ways, setWays] = useState<{ n: number; from: number; base: number } | null>(null);  // what was left, split evenly n ways
  const [picked, setPicked] = useState<number[] | null>(null); // by item: lines this person had
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("upi");
  const left = r2(total - parts.reduce((a, p) => a + p.amount, 0));
  // the next part of an even split; its last part takes whatever is left
  const evenPart = (w: { n: number; from: number; base: number }) => (parts.length - w.from + 1 >= w.n ? left : Math.min(r2(w.base / w.n), left));
  const all = lines.reduce((a, l) => a + gross(l, inclusive), 0);
  const itemsAmount = (ix: number[]) => Math.min(left, r2(ix.reduce((a, i) => a + gross(lines[i], inclusive), 0) * (all > 0 ? (all - discount) / all : 0)));
  const value = amount === "" ? (ways ? evenPart(ways) : picked ? itemsAmount(picked) : left) : r2(Number(amount));

  function take() {
    if (!(value > 0) || value > left) return;
    setParts([...parts, { mode, amount: value }]);
    setAmount(""); setPicked(null);
  }
  return (
    <div className="split">
      <header><b>{left > 0 ? `${rupees(left)} left` : "All paid"}</b><button type="button" className="btn link small" onClick={onCancel}>Don’t split</button></header>
      {parts.map((p, k) => (
        <div className="split-part" key={k}>
          <span>{MODES.find((m) => m[0] === p.mode)![1]}</span><b>{rupees(p.amount)}</b>
          <button type="button" className="btn link small" aria-label="Remove part" onClick={() => { setParts(parts.filter((_, j) => j !== k)); setWays(null); }}>×</button>
        </div>
      ))}
      {left > 0 ? <>
        <div className="split-how" role="group" aria-label="Split">
          {[2, 3, 4].map((n) => <button type="button" key={n} aria-pressed={ways?.n === n}
            onClick={() => { setWays(ways?.n === n ? null : { n, from: parts.length, base: left }); setPicked(null); setAmount(""); }}>{n} ways</button>)}
          <button type="button" aria-pressed={picked !== null} onClick={() => { setPicked(picked ? null : []); setWays(null); setAmount(""); }}>By item</button>
        </div>
        {picked && (
          <div className="split-items">
            {lines.map((l, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={picked.includes(i)} onChange={() => { setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]); setAmount(""); }} />
                <span>{l.qty} × {l.name}{l.opts?.length ? ` (${l.opts.join(", ")})` : ""}</span>
              </label>
            ))}
          </div>
        )}
        <input aria-label="Amount for this part" inputMode="decimal" value={amount} placeholder={String(value)}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <ModeButtons mode={mode} onChange={setMode} />
        {mode === "upi" && <UpiQr shop={shop} amount={value} note={note} />}
        <button type="button" className="btn alt" disabled={!(value > 0) || value > left} onClick={take}>Take {rupees(value || 0)}</button>
      </> : (
        <button type="button" className="btn pay" disabled={busy || blocked} onClick={() => onPay(parts)}>{busy ? "…" : `Paid ${rupees(total)}`}</button>
      )}
    </div>
  );
}

// Give back some items of a paid bill. The amount gets the same share of any points discount as the bill had.
export function RefundSheet({ order, shopId, inclusive, onDone, onClose }: {
  order: Order; shopId: string; inclusive: boolean; onDone: (o: Order) => void; onClose: () => void;
}) {
  const back: Record<number, number> = {};
  (order.refunds ?? []).forEach((r) => r.lines.forEach((l) => { back[l.i] = (back[l.i] ?? 0) + l.qty; }));
  const [qty, setQty] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<Mode>(order.payments?.[0]?.mode ?? "cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [refundId] = useState(() => crypto.randomUUID());
  const { askManager } = useBiz();
  const chosen = order.lines.map((l, i) => ({ ...l, qty: qty[i] ?? 0, i })).filter((l) => l.qty > 0);
  const t = order.totals!;
  const g = chosen.reduce((a, l) => a + gross(l, inclusive), 0);
  const amount = totals(chosen, inclusive, t.items > 0 ? r2((t.discount * g) / t.items) : 0).total;

  async function refund() {
    const approval = await askManager();
    if (approval === undefined) return;
    setBusy(true); setErr("");
    try { onDone(await refundOrder(shopId, order.id, chosen.map((l) => ({ i: l.i, qty: l.qty })), mode, reason.trim(), refundId, approval)); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header><b>Refund items</b><button type="button" className="btn link small" onClick={onClose}>Close</button></header>
        <div className="refund-lines">
          {order.lines.map((l, i) => {
            const can = l.qty - (back[i] ?? 0), n = qty[i] ?? 0;
            return (
              <div className={`refund-line${can <= 0 ? " gone" : ""}`} key={i}>
                <span>{l.name}{l.opts?.length ? <small>{l.opts.join(", ")}</small> : null}<small>{can <= 0 ? "Refunded" : `${can} of ${l.qty}`}</small></span>
                {can > 0 && (
                  <span className="stepper">
                    <button type="button" onClick={() => setQty({ ...qty, [i]: Math.max(0, n - 1) })} aria-label={`One less ${l.name}`}>−</button>
                    <b>{n}</b>
                    <button type="button" onClick={() => setQty({ ...qty, [i]: Math.min(can, n + 1) })} disabled={n >= can} aria-label={`One more ${l.name}`}>+</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <input placeholder="Reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} aria-label="Reason for the refund" />
        <ModeButtons mode={mode} onChange={setMode} />
        {err && <div className="msg err">{err}</div>}
        <button type="button" className="btn" disabled={busy || chosen.length === 0} onClick={refund}>{busy ? "…" : `Refund ${rupees(amount)}`}</button>
      </div>
    </div>
  );
}
