import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText } from "../lib";
import { useShop } from "../shop";
import { openOrders, type Order } from "./api";
import { useBiz } from "./BizApp";
import { rupees } from "./money";

const minutes = (t: string) => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));

// Tables and takeaways at a glance. Tap to open or continue an order.
export default function Floor() {
  const { current } = useShop();
  const { menu, owner } = useBiz();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => openOrders(current!.shop.id).then((o) => { setOrders(o); setErr(""); }).catch((e) => setErr(errorText(e))), [current]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const byTable = new Map((orders ?? []).filter((o) => o.table_id).map((o) => [o.table_id!, o]));
  const takeaways = (orders ?? []).filter((o) => !o.table_id);
  const open = (o?: Order, table?: string) => navigate(o ? `/biz/o/${o.id}` : `/biz/o/${crypto.randomUUID()}${table ? `?table=${table}` : ""}`);

  if (menu.items.length === 0) return (
    <div className="biz-empty">
      <h2>No menu yet</h2>
      {owner ? <button className="btn" onClick={() => navigate("/biz/setup")}>Set up menu</button> : <p className="hint">Ask the owner to add the menu.</p>}
    </div>
  );

  return (
    <div className="biz-pad">
      {err && <div className="msg err">{err}</div>}
      <div className="floor">
        <button className="tile tile-new" onClick={() => open()}>
          <b>+ Takeaway</b>
        </button>
        {takeaways.map((o, i) => (
          <button key={o.id} className="tile busy" onClick={() => open(o)}>
            <span className="tile-name">Takeaway {i + 1}</span>
            <b>{rupees(o.total ?? 0)}</b>
            <span className="tile-time">{minutes(o.opened_at)} min</span>
            {o.kitchen === "ready" && <span className="tile-ready">Ready</span>}
          </button>
        ))}
        {menu.tables.map((t) => {
          const o = byTable.get(t.id);
          return (
            <button key={t.id} className={`tile${o ? " busy" : ""}`} onClick={() => open(o, t.id)}>
              <span className="tile-name">{t.name}</span>
              {o ? <><b>{rupees(o.total ?? 0)}</b><span className="tile-time">{minutes(o.opened_at)} min</span></> : <span className="tile-free">Free</span>}
              {o?.kitchen === "ready" && <span className="tile-ready">Ready</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
