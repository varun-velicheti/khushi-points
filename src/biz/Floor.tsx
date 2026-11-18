import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText } from "../lib";
import { useShop } from "../shop";
import { getOrder, openOrders, type Order } from "./api";
import { getLocal } from "./offline";
import { useBiz } from "./BizApp";
import { rupees } from "./money";

const minutes = (t: string) => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));

// Without tables: straight to the counter order this device is on. It stays the same order until it is paid
// or cancelled, then a fresh one starts.
const counterKey = (shop: string) => `kb:${shop}:counter`;
function Counter() {
  const { current } = useShop();
  const navigate = useNavigate();
  useEffect(() => {
    const shop = current!.shop.id;
    let id: string | null = null;
    try { id = localStorage.getItem(counterKey(shop)); } catch { /* blocked */ }
    const go = (keep: boolean) => {
      if (!keep || !id) { id = crypto.randomUUID(); try { localStorage.setItem(counterKey(shop), id); } catch { /* blocked */ } }
      navigate(`/biz/o/${id}`, { replace: true });
    };
    if (!id) return go(false);
    const mine = getLocal(shop, id);
    if (mine) return go(mine.status === "open");
    // not on this device: it was never saved (keep it), or it is closed on the server (start fresh)
    getOrder(shop, id).then((o) => go(o.status === "open")).catch(() => go(true));
  }, [current, navigate]);
  return <div className="biz-pad hint">Loading…</div>;
}

// Tables and takeaways at a glance. Tap to open or continue an order.
export default function Floor() {
  const { menu } = useBiz();
  if (menu.items.length > 0 && menu.shop.use_tables === false) return <Counter />;
  return <Tables />;
}

function Tables() {
  const { current } = useShop();
  const { menu, owner } = useBiz();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => openOrders(current!.shop.id, menu).then((o) => { setOrders(o); setErr(""); }).catch((e) => setErr(errorText(e))), [current, menu]);
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
            {menu.shop.kitchen && o.kitchen === "ready" && <span className="tile-ready">Ready</span>}
          </button>
        ))}
        {menu.tables.map((t) => {
          const o = byTable.get(t.id);
          return (
            <button key={t.id} className={`tile${o ? " busy" : ""}`} onClick={() => open(o, t.id)}>
              <span className="tile-name">{t.name}</span>
              {o ? <><b>{rupees(o.total ?? 0)}</b><span className="tile-time">{minutes(o.opened_at)} min</span></> : <span className="tile-free">Free</span>}
              {menu.shop.kitchen && o?.kitchen === "ready" && <span className="tile-ready">Ready</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
