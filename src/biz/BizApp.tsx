import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { errorText } from "../lib";
import { useShop } from "../shop";
import { loadMenu, type Menu } from "./api";
import { cacheMenu, cachedMenu, claimDevice, flush, isNetworkError, onSync, type SyncState } from "./offline";
import Floor from "./Floor";
import OrderScreen from "./Order";
import BillScreen from "./Bill";
import Setup from "./Setup";
import Kitchen from "./Kitchen";
import "./biz.css";

// Khushi Biz: restaurant & café POS. Floor -> Order -> Bill. Setup is for the owner.
type Ctx = { menu: Menu; reload: () => Promise<void>; owner: boolean };
const BizContext = createContext<Ctx | null>(null);
export const useBiz = () => useContext(BizContext)!;

export default function BizApp() {
  const { current } = useShop();
  const shopId = current!.shop.id;
  const owner = current!.role === "owner";
  const location = useLocation();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [err, setErr] = useState("");
  const [sync, setSync] = useState<SyncState | null>(null);
  // menu from the device first (works offline), then fresh from the server
  const reload = useCallback(async () => {
    try { const m = await loadMenu(shopId); cacheMenu(shopId, m); setMenu(m); setErr(""); claimDevice(shopId).then(() => flush()).catch(() => {}); }
    catch (e) { if (!isNetworkError(e) || !cachedMenu(shopId)) setErr(errorText(e)); }
  }, [shopId]);
  useEffect(() => { setMenu(cachedMenu(shopId)); reload(); }, [shopId, reload]);
  useEffect(() => onSync(setSync), []);

  return (
    <div className="biz">
      <header className="biz-top">
        <Link to="/biz" className="biz-brand"><img src="/icon.svg" alt="" /><b>Khushi Biz</b><span>{current!.shop.name}</span></Link>
        {sync && (!sync.online || sync.waiting > 0 || sync.failed.length > 0) && (
          <button className={`sync${sync.failed.length ? " bad" : sync.online ? "" : " off"}`} onClick={() => { if (sync.failed.length) alert(sync.failed.join("\n")); else flush(); }}>
            {sync.failed.length ? `${sync.failed.length} not sent` : sync.online ? `Sending ${sync.waiting}` : sync.waiting ? `Offline · ${sync.waiting}` : "Offline"}
          </button>
        )}
        <nav>
          <NavLink to="/biz" className={() => (/^\/biz\/(setup|kitchen)/.test(location.pathname) ? "" : "active")}>Floor</NavLink>
          {menu?.shop.kitchen && <NavLink to="/biz/kitchen">Kitchen</NavLink>}
          {owner && <NavLink to="/biz/setup">Setup</NavLink>}
          <Link to="/">Khushi Points</Link>
        </nav>
      </header>
      {err && <div className="msg err biz-pad">{err}</div>}
      {!menu ? <div className="biz-pad hint">Loading…</div> : (
        <BizContext.Provider value={{ menu, reload, owner }}>
          <Routes>
            <Route index element={<Floor />} />
            <Route path="o/:id" element={<OrderScreen />} />
            <Route path="b/:id" element={<BillScreen />} />
            {menu.shop.kitchen && <Route path="kitchen" element={<Kitchen />} />}
            <Route path="setup/*" element={owner ? <Setup /> : <Navigate to="/biz" replace />} />
            <Route path="*" element={<Navigate to="/biz" replace />} />
          </Routes>
        </BizContext.Provider>
      )}
    </div>
  );
}
