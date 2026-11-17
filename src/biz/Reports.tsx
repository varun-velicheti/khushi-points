import { useEffect, useState } from "react";
import { errorText, rpc } from "../lib";
import { useShop } from "../shop";
import { paise, rupees } from "./money";
import { useBiz } from "./BizApp";

type Report = {
  bills: number; sales: number; taxable: number; gst: number; discount: number;
  by_mode: { mode: string; bills: number; amount: number }[];
  by_rate: { rate: number; taxable: number; cgst: number; sgst: number }[];
  by_day: { day: string; bills: number; sales: number }[];
  items: { name: string; qty: number; amount: number }[];
  invoices: { invoice_no: string; paid_at: string; mode: string; taxable: number; cgst: number; sgst: number; discount: number; round_off: number; total: number }[];
  // sales, GST, items and modes are already net of refunds; these are the credit notes themselves
  refunds?: { count: number; amount: number };
  credit_notes?: { credit_no: string; at: string; mode: string; taxable: number; cgst: number; sgst: number; total: number }[];
  by_staff?: { name: string; bills: number; sales: number }[];
};

// Dates as the shop's days (yyyy-mm-dd), counted on this device.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function range(kind: string): [string, string] {
  const t = new Date(), y = new Date(t); y.setDate(t.getDate() - 1);
  if (kind === "yesterday") return [iso(y), iso(y)];
  if (kind === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  if (kind === "last") return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [iso(t), iso(t)];
}
const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["month", "This month"], ["last", "Last month"]] as const;
const MODE = { upi: "UPI", cash: "Cash", card: "Card", split: "Split" } as Record<string, string>;
const qty = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function Reports() {
  const { current } = useShop();
  const shop = current!.shop;
  const [kind, setKind] = useState<string>("today");
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [from, to] = range(kind);
  // with staff PINs, a manager's PIN opens reports (the approval lasts 10 minutes, then it asks again)
  const { askManager } = useBiz();
  const [approval, setApproval] = useState<string | null | undefined>(undefined);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (approval !== undefined || cancelled) return;
    askManager().then((a) => (a === undefined ? setCancelled(true) : setApproval(a)));
  }, [approval, cancelled, askManager]);
  useEffect(() => {
    if (approval === undefined) return;
    setR(null);
    rpc<Report>("biz_report", { p_shop: shop.id, p_from: from, p_to: to, ...(approval ? { p_approval: approval } : {}) })
      .then((x) => { setR(x); setErr(""); })
      .catch((e) => { if (/MANAGER_ONLY/.test(String((e as Error).message))) setApproval(undefined); else setErr(errorText(e)); });
  }, [shop.id, from, to, approval]);

  function csv() {
    if (!r) return;
    const rows = [["Invoice", "Date", "Payment", "Taxable", "CGST", "SGST", "Points discount", "Round off", "Total"],
      ...r.invoices.map((i) => [i.invoice_no, new Date(i.paid_at).toLocaleString("en-IN"), MODE[i.mode] ?? i.mode, i.taxable, i.cgst, i.sgst, i.discount, i.round_off, i.total]),
      // credit notes as negative rows, so the file adds up to the net figures
      ...(r.credit_notes ?? []).map((c) => [c.credit_no, new Date(c.at).toLocaleString("en-IN"), `Refund ${MODE[c.mode] ?? c.mode}`, -c.taxable, -c.cgst, -c.sgst, 0, 0, -c.total])];
    const blob = new Blob([rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${shop.name}-invoices-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }
  const maxDay = Math.max(1, ...(r?.by_day.map((d) => Number(d.sales)) ?? [1]));

  return (
    <div className="biz-pad reports">
      <div className="reports-head">
        <nav className="pills">{RANGES.map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</nav>
        <button className="btn alt small" disabled={!r?.invoices.length} onClick={csv}>Download CSV</button>
      </div>
      {err && <div className="msg err">{err}</div>}
      {cancelled && approval === undefined ? (
        <div className="biz-empty"><h2>Needs a manager’s PIN</h2><button className="btn alt" onClick={() => setCancelled(false)}>Enter PIN</button></div>
      ) : !r ? <p className="hint">Loading…</p> : <>
        <div className="kpis kpis-3">
          <div className="kpi"><div className="k">Sales</div><div className="v">{rupees(r.sales)}</div><div className="n">{r.bills} bills{r.refunds?.count ? ` · ${rupees(r.refunds.amount)} refunded` : ""}</div></div>
          <div className="kpi"><div className="k">Average bill</div><div className="v">{rupees(r.bills ? Math.round(r.sales / r.bills) : 0)}</div><div className="n">{r.discount > 0 ? `${rupees(r.discount)} paid with points` : " "}</div></div>
          <div className="kpi"><div className="k">GST</div><div className="v">{rupees(r.gst)}</div><div className="n">on {rupees(r.taxable)}</div></div>
        </div>

        {r.by_mode.length > 0 && (
          <section className="panel">
            <div className="modes">
              {r.by_mode.map((m) => (
                <div key={m.mode} className="mode-row">
                  <span>{MODE[m.mode] ?? m.mode}</span>
                  <span className="bar"><i style={{ width: `${(Number(m.amount) / Number(r.sales || 1)) * 100}%` }} /></span>
                  <b>{rupees(m.amount)}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {r.by_day.length > 1 && (
          <section className="panel">
            <div className="days" aria-label="Sales by day">
              {r.by_day.map((d) => (
                <div key={d.day} className="day" title={`${d.day}: ${rupees(d.sales)}, ${d.bills} bills`}>
                  <i style={{ height: `${(Number(d.sales) / maxDay) * 100}%` }} />
                  <span>{new Date(d.day).getDate()}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {r.items.length > 0 && (
          <section className="panel">
            <h2>Items</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
              <tbody>{r.items.map((i) => <tr key={i.name}><td>{i.name}</td><td className="num">{qty(i.qty)}</td><td className="num">{rupees(i.amount)}</td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        {(r.by_staff ?? []).some((s) => s.name !== "Not set") && (
          <section className="panel">
            <h2>Staff</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Name</th><th className="num">Bills</th><th className="num">Sales</th></tr></thead>
              <tbody>{r.by_staff!.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num">{s.bills}</td><td className="num">{rupees(s.sales)}</td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        {r.by_rate.length > 0 && (
          <section className="panel">
            <h2>GST</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Rate</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th></tr></thead>
              <tbody>{r.by_rate.map((g) => <tr key={g.rate}><td>{Number(g.rate)}%</td><td className="num">{paise(g.taxable)}</td><td className="num">{paise(g.cgst)}</td><td className="num">{paise(g.sgst)}</td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        {r.bills === 0 && <div className="biz-empty"><h2>No bills</h2></div>}
      </>}
    </div>
  );
}
