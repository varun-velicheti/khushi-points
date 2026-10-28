import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtMobile, inr, rpc, when } from "../lib";
import { useShop } from "../shop";

type Row = { mobile: string; name: string; balance: number; visits: number; has_pin: boolean; pin_locked: boolean; last_visit: string | null };

export default function Customers() {
  const { current } = useShop();
  const shop = current!.shop;
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      rpc<Row[]>("list_customers", { p_shop: shop.id, p_search: q || null })
        .then((r) => { if (!stale) { setRows(r); setErr(""); } })
        .catch((e) => { if (!stale) setErr(e.message); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [q, shop.id]);

  return (
    <div className="page">
      <div className="panel">
        <h2>Customers</h2>
        <p className="sub">Tap a customer to see their balance at the counter.</p>
        <input aria-label="Search customers" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
        {err && <div className="msg err">{err}</div>}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Mobile</th><th className="num">Visits</th><th className="num">Balance</th><th>Redeem with</th><th>Last visit</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="hint">Loading…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="hint">{q ? "No customers match." : "No customers yet. Add the first bill on the Counter tab."}</td></tr>}
              {rows?.map((r) => (
                <tr key={r.mobile} className="click" onClick={() => navigate(`/?balance=${r.mobile}`)}>
                  <td>{r.name}</td>
                  <td className="mono">{fmtMobile(r.mobile)}</td>
                  <td className="num">{r.visits}</td>
                  <td className="num"><b>{r.balance}</b> <span className="hint">{inr(r.balance * Number(shop.point_value))}</span></td>
                  <td>{r.has_pin ? (r.pin_locked ? <span className="chip locked">PIN locked</span> : <span className="chip pin">PIN</span>) : <span className="chip">OTP first</span>}</td>
                  <td className="hint">{r.last_visit ? when(r.last_visit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
