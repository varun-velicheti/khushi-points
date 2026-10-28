import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { cleanMobile, errorText, inr, maskMobile, rpc, validMobile, when, type Shop } from "../lib";
import { useShop } from "../shop";

type Dash = {
  customers: number; customers_pin: number; bills_30d: number; sales_30d: number;
  points_given: number; points_redeemed: number; redeems_pin: number; redeems_otp: number;
  points_owed: number; point_value: number; sms_30d: number; sms_total: number;
};
type Staff = { user_id: string; email: string; role: string; joined_at: string };
type Activity = { created_at: string; kind: string; name: string; mobile: string; bill_no: string | null; amount: number; points: number; method: string | null };

export default function Owner() {
  const { current } = useShop();
  const shop = current!.shop;
  return (
    <div className="page">
      <Dashboard shop={shop} />
      <CustomerPage shop={shop} />
      <Settings shop={shop} />
      <StaffPanel shop={shop} />
      <ActivityPanel shop={shop} />
      <DeleteCustomer shop={shop} />
      <div className="actions"><Link className="btn link" to="/add-shop">Add or join another shop</Link></div>
    </div>
  );
}

function Dashboard({ shop }: { shop: Shop }) {
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { rpc<Dash>("shop_dashboard", { p_shop: shop.id }).then(setD).catch(() => {}); }, [shop.id]);
  if (!d) return <div className="kpis"><div className="kpi"><div className="k">Loading…</div></div></div>;
  const redeems = d.redeems_pin + d.redeems_otp;
  const tiles: [string, string | number, string][] = [
    ["Customers", d.customers, `${d.customers_pin} have a PIN`],
    ["Sales, last 30 days", inr(d.sales_30d), `${d.bills_30d} bills with points`],
    ["Points given", d.points_given, `${d.points_redeemed} redeemed`],
    ["Points still owed", inr(d.points_owed * d.point_value), `${d.points_owed} unused points`],
    ["SMS, last 30 days", d.sms_30d, `${d.redeems_pin} of ${redeems} redemptions used a free PIN`],
  ];
  return (
    <div className="kpis">
      {tiles.map(([k, v, n]) => <div className="kpi" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="n">{n}</div></div>)}
    </div>
  );
}

function CustomerPage({ shop }: { shop: Shop }) {
  const url = `${window.location.origin}/b/${shop.slug}`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 240 }).then(setQr).catch(() => {}); }, [url]);
  const copy = () => navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {});
  return (
    <div className="panel">
      <h2>Customer balance page</h2>
      <p className="sub">Print this QR code and keep it at the counter. Customers scan it to check their points. No app or login needed.</p>
      <div className="actions" style={{ alignItems: "flex-start" }}>
        {qr && <img src={qr} alt={`QR code for ${url}`} width={160} height={160} style={{ borderRadius: 8, background: "#fff" }} />}
        <div className="stack" style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ wordBreak: "break-all" }}>{url}</div>
          <div className="actions">
            <button className="btn alt small" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            {qr && <a className="btn alt small" href={qr} download={`${shop.slug}-qr.png`}>Download QR</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Settings({ shop }: { shop: Shop }) {
  const { updateShop } = useShop();
  const [f, setF] = useState({
    name: shop.name, earn_pct: String(shop.earn_pct), point_value: String(shop.point_value), min_bill: String(shop.min_bill),
    min_redeem: String(shop.min_redeem), max_redeem_pct: String(shop.max_redeem_pct), expiry_days: String(shop.expiry_days),
    one_bill_per_day: shop.one_bill_per_day,
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      const s = await rpc<Shop>("update_shop_settings", { p_shop: shop.id, p: f });
      updateShop(s);
      setMsg({ kind: "ok", text: "Saved. New rules apply from the next bill." });
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); }
  }

  const ex = 1000, exPts = Math.floor((ex * (parseFloat(f.earn_pct) || 0)) / 100 / (parseFloat(f.point_value) || 1));
  return (
    <form className="panel stack" onSubmit={save} autoComplete="off">
      <div><h2>Points rules</h2><p className="sub">Example: a {inr(ex)} bill earns {exPts} points, worth {inr(exPts * (parseFloat(f.point_value) || 0))}.</p></div>
      <div className="row">
        <div><label htmlFor="s-name">Shop name</label><input id="s-name" value={f.name} onChange={set("name")} /></div>
        <div><label htmlFor="s-pct">Points earned (% of bill)</label><input id="s-pct" inputMode="decimal" value={f.earn_pct} onChange={set("earn_pct")} /></div>
        <div><label htmlFor="s-val">Value of 1 point (₹)</label><input id="s-val" inputMode="decimal" value={f.point_value} onChange={set("point_value")} /></div>
      </div>
      <div className="row">
        <div><label htmlFor="s-minbill">Minimum bill (₹)</label><input id="s-minbill" inputMode="numeric" value={f.min_bill} onChange={set("min_bill")} /></div>
        <div><label htmlFor="s-minred">Minimum points to redeem</label><input id="s-minred" inputMode="numeric" value={f.min_redeem} onChange={set("min_redeem")} /></div>
        <div><label htmlFor="s-maxpct">Max discount (% of bill)</label><input id="s-maxpct" inputMode="numeric" value={f.max_redeem_pct} onChange={set("max_redeem_pct")} /></div>
      </div>
      <div className="row">
        <div><label htmlFor="s-exp">Points expire after (days)</label><input id="s-exp" inputMode="numeric" value={f.expiry_days} onChange={set("expiry_days")} /></div>
        <div><label htmlFor="s-day">Bills per number per day</label>
          <select id="s-day" value={f.one_bill_per_day ? "1" : "0"} onChange={(e) => setF({ ...f, one_bill_per_day: e.target.value === "1" })}>
            <option value="1">Only 1 bill earns</option><option value="0">No limit</option>
          </select></div>
      </div>
      <div className="actions"><button className="btn">Save rules</button></div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
    </form>
  );
}

function StaffPanel({ shop }: { shop: Shop }) {
  const { updateShop, session } = useShop();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [err, setErr] = useState("");
  const load = () => rpc<Staff[]>("list_staff", { p_shop: shop.id }).then(setStaff).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function newCode() {
    try { const c = await rpc<string>("new_join_code", { p_shop: shop.id }); updateShop({ ...shop, join_code: c }); }
    catch (e) { setErr((e as Error).message); }
  }
  async function remove(id: string) {
    try { await rpc("remove_staff", { p_shop: shop.id, p_user: id }); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="panel stack">
      <div><h2>Staff</h2><p className="sub">Cashiers sign up on this app and enter the shop code. They can add bills and redeem, but cannot change rules or see this page.</p></div>
      <div className="actions"><span className="codebox">{shop.join_code}</span>
        <button className="btn alt small" onClick={newCode}>Make a new code</button></div>
      <p className="hint">Making a new code stops the old one from working. People who already joined stay.</p>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
        <tbody>{staff.map((s) => (
          <tr key={s.user_id}><td>{s.email}</td><td>{s.role === "owner" ? "Owner" : "Cashier"}</td><td>{when(s.joined_at)}</td>
            <td className="num">{s.role === "cashier" && s.user_id !== session?.user.id && <button className="btn danger small" onClick={() => remove(s.user_id)}>Remove</button>}</td></tr>
        ))}</tbody>
      </table></div>
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function ActivityPanel({ shop }: { shop: Shop }) {
  const [rows, setRows] = useState<Activity[] | null>(null);
  useEffect(() => { rpc<Activity[]>("recent_activity", { p_shop: shop.id, p_limit: 50 }).then(setRows).catch(() => setRows([])); }, [shop.id]);
  return (
    <div className="panel">
      <h2>Recent activity</h2><p className="sub">The last 50 bills and redemptions.</p>
      <div className="tbl-wrap"><table>
        <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Bill</th><th className="num">Amount</th><th className="num">Points</th></tr></thead>
        <tbody>
          {rows?.length === 0 && <tr><td colSpan={6} className="hint">Nothing yet.</td></tr>}
          {rows?.map((t, i) => (
            <tr key={i}>
              <td>{when(t.created_at)}</td>
              <td><span className={`chip ${t.kind}`}>{t.kind === "earn" ? "Earned" : "Redeemed"}</span>{t.method && <span className="hint"> {t.method.toUpperCase()}</span>}</td>
              <td>{t.name}<div className="hint mono">{maskMobile(t.mobile)}</div></td>
              <td className="mono">{t.bill_no ?? ""}</td>
              <td className="num">{inr(t.amount)}</td>
              <td className="num">{t.kind === "earn" ? "+" : "−"}{t.points}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function DeleteCustomer({ shop }: { shop: Shop }) {
  const [mobile, setMobile] = useState("");
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function del(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const m = cleanMobile(mobile);
    if (!validMobile(m)) return setMsg({ kind: "err", text: errorText("BAD_MOBILE") });
    if (!armed) return setArmed(true);
    try {
      await rpc("delete_customer", { p_shop: shop.id, p_mobile: m });
      setMsg({ kind: "ok", text: `Deleted all data for ${maskMobile(m)}.` }); setMobile(""); setArmed(false);
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); setArmed(false); }
  }
  return (
    <form className="panel stack" onSubmit={del} autoComplete="off">
      <div><h2>Delete a customer's data</h2><p className="sub">When a customer asks, delete their number, points and history. This cannot be undone.</p></div>
      <div><label htmlFor="d-mobile">Customer mobile</label><input id="d-mobile" className="mono" inputMode="numeric" maxLength={14} value={mobile} onChange={(e) => { setMobile(e.target.value); setArmed(false); }} /></div>
      <div className="actions">
        <button className="btn danger">{armed ? "Tap again to delete for good" : "Delete customer"}</button>
        {armed && <button type="button" className="btn alt" onClick={() => setArmed(false)}>Cancel</button>}
      </div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
    </form>
  );
}
