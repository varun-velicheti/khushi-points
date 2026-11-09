import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText, rpc } from "../lib";
import { useShop } from "../shop";
import { rupees } from "./money";

type BillRow = { id: string; invoice_no: string; paid_at: string; status: "paid" | "void"; total: number; mode: string;
  table: string | null; items: number; customer: string | null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function range(kind: string): [string, string] {
  const t = new Date(), y = new Date(t); y.setDate(t.getDate() - 1);
  if (kind === "yesterday") return [iso(y), iso(y)];
  if (kind === "week") { const w = new Date(t); w.setDate(t.getDate() - 6); return [iso(w), iso(t)]; }
  if (kind === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  return [iso(t), iso(t)];
}
const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "7 days"], ["month", "This month"]] as const;
const MODE: Record<string, string> = { upi: "UPI", cash: "Cash", card: "Card" };

// Every paid (and voided) bill. Tap one to see, reprint or void it.
export default function Bills() {
  const { current } = useShop();
  const navigate = useNavigate();
  const [kind, setKind] = useState<string>("today");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<BillRow[] | null>(null);
  const [err, setErr] = useState("");
  const [from, to] = range(kind);
  useEffect(() => {
    const t = setTimeout(() => {
      rpc<BillRow[]>("biz_bills", { p_shop: current!.shop.id, p_from: q ? iso(new Date(Date.now() - 365 * 864e5)) : from, p_to: to, p_search: q || null })
        .then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(errorText(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [current, from, to, q]);
  const paid = (rows ?? []).filter((r) => r.status === "paid");

  return (
    <div className="biz-pad bills">
      <div className="bills-head">
        <nav className="pills">{RANGES.map(([k, l]) => <button key={k} aria-pressed={!q && kind === k} onClick={() => { setKind(k); setQ(""); }}>{l}</button>)}</nav>
        <input aria-label="Search bills" placeholder="Invoice or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <div className="msg err">{err}</div>}
      {rows && rows.length > 0 && <div className="hint">{paid.length} bills · {rupees(paid.reduce((a, r) => a + Number(r.total), 0))}</div>}
      {rows === null ? <p className="hint">Loading…</p> : rows.length === 0 ? <div className="biz-empty"><h2>No bills</h2></div> : (
        rows.map((r) => (
          <button key={r.id} className={`bill-row${r.status === "void" ? " void" : ""}`} onClick={() => navigate(`/biz/b/${r.id}`)}>
            <span className="mono">{r.invoice_no}</span>
            <span className="hint">{new Date(r.paid_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
            <span className="hide-sm">{r.table ?? "Takeaway"} · {r.items} items{r.customer ? ` · ${r.customer}` : ""}</span>
            <span className="hint hide-sm">{r.status === "void" ? "Void" : MODE[r.mode] ?? r.mode}</span>
            <b>{rupees(r.total)}</b>
          </button>
        ))
      )}
    </div>
  );
}
