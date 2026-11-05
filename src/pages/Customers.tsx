import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtMobile, inr, rpc, when } from "../lib";
import { useShop } from "../shop";

type Row = { mobile: string | null; name: string; balance: number; visits: number; has_app: boolean; last_visit: string | null;
  visits_90d: number; is_regular: boolean };

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
            <thead><tr><th>Customer</th><th>Mobile</th><th className="num">Visits</th><th className="num">Balance</th><th>App</th><th>Last visit</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="hint">Loading…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="hint">{q ? "No customers match." : "No customers yet. Add the first bill on the Counter tab."}</td></tr>}
              {rows?.map((r) => (
                <tr key={r.mobile ?? r.name + r.last_visit} className={r.mobile ? "click" : ""} onClick={() => r.mobile && navigate(`/?balance=${r.mobile}`)}>
                  <td>{r.name}{r.is_regular && <> <span className="chip regular">Regular</span></>}</td>
                  <td className="mono">{fmtMobile(r.mobile)}</td>
                  <td className="num">{r.visits}<div className="hint">{r.visits_90d} in 90 days</div></td>
                  <td className="num"><b>{r.balance} pts</b><div className="hint">worth {inr(r.balance * Number(shop.point_value))}</div></td>
                  <td>{r.has_app ? <span className="chip app">Has app</span> : <span className="chip">No app yet</span>}</td>
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
