import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { errorText } from "../lib";
import { useShop } from "../shop";
import { loadMenu, type Menu, type Staff } from "./api";
import { Lock, ManagerPin, Shift, saveStaff, savedStaff } from "./Staff";
import { cacheMenu, cachedMenu, claimDevice, flush, isNetworkError, onSync, type SyncState } from "./offline";
import Floor from "./Floor";
import OrderScreen from "./Order";
import BillScreen from "./Bill";
import Setup from "./Setup";
import Kitchen from "./Kitchen";
import Reports from "./Reports";
import Bills from "./Bills";
import "./biz.css";

// Kushly POS: restaurant & café POS. Floor -> Order -> Bill. Setup is for the owner.
// staffOn: the shop has staff PINs, so this device asks who is there and a manager for voids, refunds and reports.
// askManager() gives an approval token, null when the owner's own login is enough, or undefined when cancelled.
type Ctx = { menu: Menu; reload: () => Promise<void>; owner: boolean; staff: Staff | null; staffOn: boolean;
  askManager: () => Promise<string | null | undefined> };
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
  useEffect(() => { setMenu(current!.shop.biz_enabled === false ? null : cachedMenu(shopId)); reload(); }, [shopId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  // refresh every minute so stock counts include other devices' sales
  useEffect(() => { const i = setInterval(() => { if (navigator.onLine) reload(); }, 60000); return () => clearInterval(i); }, [reload]);
  useEffect(() => onSync(setSync), []);
  const [staff, setStaffState] = useState<Staff | null>(() => savedStaff(shopId));
  const setStaff = (s: Staff | null) => { saveStaff(shopId, s); setStaffState(s); };
  const [cash, setCash] = useState(false);
  const [asking, setAsking] = useState(false);
  const answer = useRef<(v: string | null | undefined) => void>(() => {});
  const staffList = menu?.staff ?? [];
  const staffOn = staffList.length > 0;
  // someone removed from the staff list is signed out of this device
  useEffect(() => { if (menu && staff && !staffList.some((s) => s.id === staff.id)) setStaff(null); }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const askManager = useCallback(() => {
    if (!staffOn) return Promise.resolve(owner ? null : undefined);
    setAsking(true);
    return new Promise<string | null | undefined>((res) => { answer.current = (v) => { setAsking(false); res(v); }; });
  }, [staffOn, owner]);

  return (
    <div className="biz p-pos">
      <header className="biz-top">
        <Link to="/biz" className="biz-brand"><img src="/pos.svg" alt="" /><b className="wordmark">kushly</b><span className="product">POS</span><span>{current!.shop.name}</span></Link>
        {sync && (!sync.online || sync.waiting > 0 || sync.failed.length > 0) && (
          <button className={`sync${sync.failed.length ? " bad" : sync.online ? "" : " off"}`} onClick={() => { if (sync.failed.length) alert(sync.failed.join("\n")); else flush(); }}>
            {sync.failed.length ? `${sync.failed.length} not sent` : sync.online ? `Sending ${sync.waiting}` : sync.waiting ? `Offline · ${sync.waiting}` : "Offline"}
          </button>
        )}
        {staffOn && staff && <>
          <button className="who-btn" onClick={() => setCash(true)}>Drawer</button>
          <button className="who-btn" onClick={() => setStaff(null)} title="Switch">{staff.name}</button>
        </>}
        {!staffOn && <button className="who-btn" onClick={() => setCash(true)}>Drawer</button>}
        <nav>
          <NavLink to="/biz" className={() => (/^\/biz\/(setup|kitchen|reports|bills)/.test(location.pathname) ? "" : "active")}>Floor</NavLink>
          {menu?.shop.kitchen && <NavLink to="/biz/kitchen">Kitchen</NavLink>}
          <NavLink to="/biz/bills">Bills</NavLink>
          {(owner || staffOn) && <NavLink to="/biz/reports">Reports</NavLink>}
          {owner && <NavLink to="/biz/setup">Setup</NavLink>}
          <Link to="/"><img src="/rewards.svg" alt="" className="btn-icon" />Rewards</Link>
        </nav>
      </header>
      {err && !menu ? (
        <div className="biz-empty"><h2>{err}</h2><Link className="btn alt" to="/">Back to Rewards</Link></div>
      ) : !menu ? <div className="biz-pad hint">Loading…</div> : staffOn && !staff ? (
        <Lock shop={shopId} staffList={staffList} onIn={setStaff} />
      ) : (
        <BizContext.Provider value={{ menu, reload, owner, staff, staffOn, askManager }}>
          <Routes>
            <Route index element={<Floor />} />
            <Route path="o/:id" element={<OrderScreen />} />
            <Route path="b/:id" element={<BillScreen />} />
            {menu.shop.kitchen && <Route path="kitchen" element={<Kitchen />} />}
            <Route path="bills" element={<Bills />} />
            <Route path="reports" element={owner || staffOn ? <Reports /> : <Navigate to="/biz" replace />} />
            <Route path="setup/*" element={owner ? <Setup /> : <Navigate to="/biz" replace />} />
            <Route path="*" element={<Navigate to="/biz" replace />} />
          </Routes>
          {cash && <Shift shop={shopId} staff={staff} onClose={() => setCash(false)} />}
          {asking && <ManagerPin shop={shopId} staffList={staffList} onDone={(v) => answer.current(v ?? undefined)} />}
        </BizContext.Provider>
      )}
    </div>
  );
}
