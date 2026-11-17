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
  previous?: { from: string; to: string; sales: number; bills: number };
  by_hour?: { hour: number; bills: number; sales: number }[];
  gstr1?: { state: string | null; hsn: { hsn: string; rate: number; qty: number; value: number; taxable: number; tax: number }[];
    docs: { kind: "invoice" | "credit"; from: string; to: string; total: number; cancelled: number }[] };
};

// GST state codes (first two digits of a GSTIN) as the GST offline tool names them.
const STATES: Record<string, string> = { "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory" };
const csvText = (rows: (string | number)[][]) => rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

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
const RANGE_WORD: Record<string, string> = { today: "day", yesterday: "day", month: "period", last: "month" };
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
    download(`${shop.name}-invoices-${from}-to-${to}.csv`, csvText(rows));
  }
  // GSTR-1 files in the GST offline tool's CSV layout (B2C sales are intra-state: CGST + SGST)
  function gstr1(kind: "b2cs" | "hsn" | "docs") {
    if (!r?.gstr1) return;
    const g = r.gstr1, pos = g.state ? `${g.state}-${STATES[g.state] ?? ""}` : "";
    const rows = kind === "b2cs"
      ? [["Type", "Place Of Supply", "Rate", "Applicable % of Tax Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
         ...r.by_rate.map((x) => ["OE", pos, Number(x.rate), "", Number(x.taxable).toFixed(2), "0.00", ""])]
      : kind === "hsn"
      ? [["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
         ...g.hsn.map((h) => {
           const c = Math.round((Number(h.tax) / 2 + Number.EPSILON) * 100) / 100;
           return [h.hsn, h.hsn === "996331" ? "Restaurant service" : "", "NOS-NUMBERS", String(Number(h.qty)), Number(h.value).toFixed(2), Number(h.rate),
             Number(h.taxable).toFixed(2), "0.00", c.toFixed(2), (Number(h.tax) - c).toFixed(2), "0.00"];
         })]
      : [["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
         ...g.docs.map((d) => [d.kind === "invoice" ? "Invoices for outward supply" : "Credit Note", d.from, d.to, d.total, d.cancelled])];
    download(`${shop.name}-gstr1-${kind}-${from}-to-${to}.csv`, csvText(rows));
  }
  const change = r?.previous && Number(r.previous.sales) > 0 ? Math.round(((Number(r.sales) - Number(r.previous.sales)) / Number(r.previous.sales)) * 100) : null;
  const maxHour = Math.max(1, ...(r?.by_hour?.map((h) => Number(h.sales)) ?? [1]));
  // every hour from the first sale to the last, quiet hours included (an empty bar, not a gap)
  const hours = r?.by_hour?.length ? Array.from({ length: r.by_hour[r.by_hour.length - 1].hour - r.by_hour[0].hour + 1 }, (_, k) => {
    const hour = r.by_hour![0].hour + k;
    return r.by_hour!.find((x) => x.hour === hour) ?? { hour, bills: 0, sales: 0 };
  }) : [];
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
          <div className="kpi"><div className="k">Sales</div><div className="v">{rupees(r.sales)}</div><div className="n">{r.bills} bills{r.refunds?.count ? ` · ${rupees(r.refunds.amount)} refunded` : ""}</div>
            {change !== null && <div className={`n change ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs previous {RANGE_WORD[kind]}</div>}</div>
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

        {(r.by_hour?.length ?? 0) > 1 && (
          <section className="panel">
            <h2>By hour</h2>
            <div className="days hours" aria-label="Sales by hour">
              {hours.map((h) => (
                <div key={h.hour} className="day" title={`${hourLabel(h.hour)}: ${rupees(h.sales)}, ${h.bills} bills`}>
                  <i style={{ height: `${(Number(h.sales) / maxHour) * 100}%` }} />
                  <span>{hourLabel(h.hour)}</span>
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

        {r.gstr1 && r.bills > 0 && (
          <section className="panel gst-files">
            <h2>GSTR-1</h2>
            {!r.gstr1.state && <p className="hint">Add your GSTIN in Setup → Billing for the place of supply.</p>}
            <div className="gst-buttons">
              <button className="btn alt small" onClick={() => gstr1("b2cs")}>B2C sales</button>
              <button className="btn alt small" onClick={() => gstr1("hsn")}>HSN summary</button>
              <button className="btn alt small" onClick={() => gstr1("docs")}>Documents</button>
            </div>
            <p className="hint">Net of refunds. Items without an HSN code are listed as 996331, restaurant service.</p>
          </section>
        )}

        {r.bills === 0 && <div className="biz-empty"><h2>No bills</h2></div>}
      </>}
    </div>
  );
}
