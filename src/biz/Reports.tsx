import { useEffect, useState } from "react";
import { errorText, rpc } from "../lib";
import { useShop } from "../shop";
import { paise, rupees } from "./money";

type Report = {
  bills: number; sales: number; taxable: number; gst: number; discount: number;
  by_mode: { mode: string; bills: number; amount: number }[];
  by_rate: { rate: number; taxable: number; cgst: number; sgst: number }[];
  by_day: { day: string; bills: number; sales: number }[];
  items: { name: string; qty: number; amount: number }[];
  invoices: { invoice_no: string; paid_at: string; mode: string; taxable: number; cgst: number; sgst: number; discount: number; round_off: number; total: number }[];
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
const MODE = { upi: "UPI", cash: "Cash", card: "Card" } as Record<string, string>;
const qty = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function Reports() {
  const { current } = useShop();
  const shop = current!.shop;
  const [kind, setKind] = useState<string>("today");
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [from, to] = range(kind);
  useEffect(() => {
    setR(null);
    rpc<Report>("biz_report", { p_shop: shop.id, p_from: from, p_to: to }).then((x) => { setR(x); setErr(""); }).catch((e) => setErr(errorText(e)));
  }, [shop.id, from, to]);

  function csv() {
    if (!r) return;
    const rows = [["Invoice", "Date", "Payment", "Taxable", "CGST", "SGST", "Points discount", "Round off", "Total"],
      ...r.invoices.map((i) => [i.invoice_no, new Date(i.paid_at).toLocaleString("en-IN"), MODE[i.mode] ?? i.mode, i.taxable, i.cgst, i.sgst, i.discount, i.round_off, i.total])];
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
      {!r ? <p className="hint">Loading…</p> : <>
        <div className="kpis kpis-3">
          <div className="kpi"><div className="k">Sales</div><div className="v">{rupees(r.sales)}</div><div className="n">{r.bills} bills</div></div>
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
