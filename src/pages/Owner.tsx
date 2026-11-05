import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { cleanMobile, errorText, inr, logoUrl, maskMobile, rpc, supabase, validMobile, when, type Shop } from "../lib";
import { useShop } from "../shop";
import UndoButton from "../Undo";

type Dash = {
  customers: number; customers_app: number; followers: number; bills_30d: number; sales_30d: number;
  active_30d: number; repeat_30d: number; lapsed: number; regulars: number; regular_visits: number;
  points_given: number; points_redeemed: number; points_expired: number; redeems_app: number;
  points_owed: number; point_value: number; offers_7d: number;
};
type Staff = { user_id: string; email: string; role: string; joined_at: string };
type Activity = { id: number; undone: boolean; created_at: string; kind: string; name: string; mobile: string; bill_no: string | null; amount: number; points: number; method: string | null };

export default function Owner() {
  const { current } = useShop();
  const shop = current!.shop;
  return (
    <div className="page">
      <Dashboard shop={shop} />
      <Offers shop={shop} />
      <Rewards shop={shop} />
      <WinBack shop={shop} />
      <Profile shop={shop} />
      <Settings shop={shop} />
      <CustomerPage shop={shop} />
      <StaffPanel shop={shop} />
      <PosConnect shop={shop} />
      <ActivityPanel shop={shop} />
      <DeleteCustomer shop={shop} />
      <div className="actions"><Link className="btn link" to="/add-shop">Add or join another shop</Link></div>
      <DeleteShop shop={shop} />
    </div>
  );
}

function Dashboard({ shop }: { shop: Shop }) {
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { rpc<Dash>("shop_dashboard", { p_shop: shop.id }).then(setD).catch(() => {}); }, [shop.id]);
  if (!d) return <div className="kpis"><div className="kpi"><div className="k">Loading…</div></div></div>;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const tiles: [string, string | number, string][] = [
    ["Repeat customers, 30 days", d.repeat_30d, `${pct(d.repeat_30d, d.active_30d)} of ${d.active_30d} customers came back`],
    ["Sales with points, 30 days", inr(d.sales_30d), `${d.bills_30d} bills`],
    ["Regulars", d.regulars, `${d.regular_visits}+ visits in 90 days`],
    ["Customers", d.customers, `${d.customers_app} use the app · ${d.followers} follow you`],
    ["Not back in 30 days", d.lapsed, "Send them an offer"],
    ["Points still owed", inr(d.points_owed * d.point_value), `${d.points_redeemed} redeemed · ${d.points_expired} expired`],
  ];
  return (
    <div className="kpis">
      {tiles.map(([k, v, n]) => <div className="kpi" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="n">{n}</div></div>)}
    </div>
  );
}

const CATEGORIES: [string, string][] = [
  ["restaurant", "Restaurant"], ["cafe", "Café"], ["bakery", "Bakery"], ["sweets", "Sweets"], ["icecream", "Ice cream"],
  ["grocery", "Grocery / kirana"], ["supermarket", "Supermarket"], ["clothing", "Clothing"], ["salon", "Salon / beauty"],
  ["pharmacy", "Pharmacy"], ["electronics", "Electronics"], ["other", "Other"],
];

function Profile({ shop }: { shop: Shop }) {
  const { updateShop } = useShop();
  const [f, setF] = useState({
    name: shop.name, category: shop.category ?? "", about: shop.about ?? "", address: shop.address ?? "", area: shop.area ?? "",
    city: shop.city ?? "", contact_phone: shop.contact_phone ?? "", hours: shop.hours ?? "",
    lat: shop.lat?.toString() ?? "", lng: shop.lng?.toString() ?? "",
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function locate() {
    if (!navigator.geolocation) return setMsg({ kind: "err", text: "This browser cannot share location. Skip it for now." });
    navigator.geolocation.getCurrentPosition(
      (p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })),
      () => setMsg({ kind: "err", text: "Could not get the location. Allow location access, or do this from the shop later." }),
      { enableHighAccuracy: true, timeout: 10000 });
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      const s = await rpc<Shop>("update_shop_settings", { p_shop: shop.id, p: f });
      updateShop(s);
      setMsg({ kind: "ok", text: "Saved. Customers see this in the Khushi Points app." });
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); }
  }
  return (
    <form className="panel stack" onSubmit={save} autoComplete="off">
      <div><h2>Shop details</h2><p className="sub">What customers see about {shop.name} in their app.</p></div>
      <LogoPicker shop={shop} />
      <div><label htmlFor="p-name">Shop name</label><input id="p-name" maxLength={80} value={f.name} onChange={set("name")} required /></div>
      <div className="row">
        <div><label htmlFor="p-cat">Type of shop</label>
          <select id="p-cat" value={f.category} onChange={set("category")}><option value="">Choose…</option>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="p-hours">Opening hours</label><input id="p-hours" maxLength={80} value={f.hours} onChange={set("hours")} placeholder="10am – 10pm, closed Monday" /></div>
        <div><label htmlFor="p-phone">Shop phone</label><input id="p-phone" inputMode="tel" maxLength={16} value={f.contact_phone} onChange={set("contact_phone")} /></div>
      </div>
      <div><label htmlFor="p-about">About the shop</label><textarea id="p-about" rows={2} maxLength={300} value={f.about} onChange={set("about")} placeholder="Hyderabadi dum biryani since 2009." /></div>
      <div><label htmlFor="p-addr">Address</label><input id="p-addr" maxLength={200} value={f.address} onChange={set("address")} /></div>
      <div className="row">
        <div><label htmlFor="p-area">Area</label><input id="p-area" maxLength={60} value={f.area} onChange={set("area")} placeholder="Madhapur" /></div>
        <div><label htmlFor="p-city">City</label><input id="p-city" maxLength={60} value={f.city} onChange={set("city")} placeholder="Hyderabad" /></div>
      </div>
      <div className="actions">
        <button type="button" className="btn alt small" onClick={locate}>Use this phone's location</button>
        <span className="hint">{f.lat && f.lng ? `Location saved: ${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}` : "Do this while standing in the shop, for directions in the app."}</span>
      </div>
      <div className="actions"><button className="btn">Save details</button></div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
    </form>
  );
}

type Offer = { id: number; title: string; body: string; valid_until: string | null; created_at: string; recipients: number;
  edited_at: string | null; removed_at: string | null };
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Offers({ shop }: { shop: Shop }) {
  const [list, setList] = useState<Offer[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const load = () => rpc<Offer[]>("shop_offers", { p_shop: shop.id }).then(setList).catch(() => {});
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekCount = list.filter((o) => Date.now() - new Date(o.created_at).getTime() < 7 * 864e5).length;

  async function send(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await rpc<{ offer_id: number; followers: number }>("send_offer", { p_shop: shop.id, p_title: title, p_body: body, p_valid_until: until || null });
      const { data } = await supabase.functions.invoke("push", { body: { action: "offer", shop_id: shop.id, offer_id: r.offer_id } });
      setMsg({ kind: "ok", text: `Offer posted for ${r.followers} follower${r.followers === 1 ? "" : "s"}.${data?.devices ? ` Notification sent to ${data.devices} phone${data.devices === 1 ? "" : "s"}.` : ""}` });
      setTitle(""); setBody(""); setUntil(""); load();
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel stack">
      <div><h2>Send an offer</h2><p className="sub">Goes to customers who follow {shop.name} in the app, as a notification. Up to 2 a week, so it never feels like spam. {weekCount}/2 used this week.</p></div>
      <form className="stack" onSubmit={send} autoComplete="off">
        <div><label htmlFor="o-title">Offer</label><input id="o-title" required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend special: double points on biryani" /></div>
        <div><label htmlFor="o-body">Details (optional)</label><textarea id="o-body" rows={2} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Saturday and Sunday, dine-in and takeaway." /></div>
        <div className="row"><div><label htmlFor="o-until">Valid until (optional)</label><input id="o-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div></div>
        <div className="actions"><button className="btn gold" disabled={busy || weekCount >= 2}>{busy ? "Sending…" : "Send offer"}</button></div>
        {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      </form>
      {list.length > 0 && (
        <div className="stack">
          <span className="label">Your offers</span>
          {list.map((o) => <OfferRow key={o.id} shop={shop} offer={o} onChange={load} />)}
          <p className="hint">Editing changes the offer in customers' apps without a new notification. A removed offer disappears from their apps but still counts toward this week's 2.</p>
        </div>
      )}
    </div>
  );
}

function OfferRow({ shop, offer: o, onChange }: { shop: Shop; offer: Offer; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(o.title);
  const [body, setBody] = useState(o.body);
  const [until, setUntil] = useState(o.valid_until ?? "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const expired = !!o.valid_until && o.valid_until < new Date().toISOString().slice(0, 10);

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await rpc("update_offer", { p_shop: shop.id, p_offer: o.id, p_title: title, p_body: body, p_valid_until: until || null });
      setEditing(false); onChange();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!armed) return setArmed(true);
    setBusy(true);
    try { await rpc("remove_offer", { p_shop: shop.id, p_offer: o.id }); onChange(); }
    catch (x) { setErr(errorText(x)); setArmed(false); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <form className="offer-card stack" onSubmit={save} autoComplete="off">
        <div><label htmlFor={`oe-t-${o.id}`}>Offer</label><input id={`oe-t-${o.id}`} required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label htmlFor={`oe-b-${o.id}`}>Details</label><textarea id={`oe-b-${o.id}`} rows={2} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="row"><div><label htmlFor={`oe-u-${o.id}`}>Valid until</label><input id={`oe-u-${o.id}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div></div>
        <div className="actions">
          <button className="btn small" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn alt small" onClick={() => { setEditing(false); setTitle(o.title); setBody(o.body); setUntil(o.valid_until ?? ""); setErr(""); }}>Cancel</button>
        </div>
        {err && <div className="msg err">{err}</div>}
      </form>
    );
  }
  return (
    <div className={`offer-card${o.removed_at ? " removed" : ""}`}>
      <div className="offer-top">
        <div style={{ minWidth: 0 }}>
          <div className="offer-title">{o.title}</div>
          {o.body && <div className="hint">{o.body}</div>}
          <div className="hint">
            Sent {when(o.created_at)} to {o.recipients} follower{o.recipients === 1 ? "" : "s"}
            {o.valid_until ? ` · valid until ${shortDate(o.valid_until)}` : ""}
            {o.edited_at && !o.removed_at ? " · edited" : ""}
          </div>
        </div>
        {o.removed_at ? <span className="chip">Removed</span> : expired ? <span className="chip">Ended</span> : <span className="chip app">Live</span>}
      </div>
      {!o.removed_at && (
        <div className="actions">
          <button className="btn alt small" onClick={() => setEditing(true)}>Edit</button>
          <button className={`btn small ${armed ? "danger" : "alt"}`} onClick={remove} disabled={busy}>{armed ? "Tap again to remove" : "Remove"}</button>
          {armed && <button className="btn link small" onClick={() => setArmed(false)}>Keep</button>}
        </div>
      )}
      {err && <div className="msg err">{err}</div>}
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
    earn_pct: String(shop.earn_pct), point_value: String(shop.point_value), min_bill: String(shop.min_bill),
    min_redeem: String(shop.min_redeem), max_redeem_pct: String(shop.max_redeem_pct), expiry_days: String(shop.expiry_days),
    one_bill_per_day: shop.one_bill_per_day, reminder_days: shop.reminder_days ?? [7, 1], regular_visits: String(shop.regular_visits ?? 5),
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggleDay = (d: number) => setF((x) => {
    const has = x.reminder_days.includes(d);
    if (!has && x.reminder_days.length >= 3) return x;
    return { ...x, reminder_days: has ? x.reminder_days.filter((y) => y !== d) : [...x.reminder_days, d].sort((a, b) => b - a) };
  });

  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const rv = Number(f.regular_visits);
    if (!Number.isInteger(rv) || rv < 2 || rv > 30) return setMsg({ kind: "err", text: "Visits to become a Regular must be between 2 and 30." });
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
        <div><label htmlFor="s-day">Several bills in one day</label>
          <select id="s-day" value={f.one_bill_per_day ? "1" : "0"} onChange={(e) => setF({ ...f, one_bill_per_day: e.target.value === "1" })}>
            <option value="1">Only the highest bill earns</option><option value="0">Every bill earns</option>
          </select></div>
        <div><label htmlFor="s-reg">Visits to become a Regular</label><input id="s-reg" inputMode="numeric" value={f.regular_visits} onChange={set("regular_visits")} /></div>
      </div>
      <p className="hint" style={{ margin: 0 }}>A customer becomes a Regular after that many visits in the last 90 days (a visit is a day with a bill). They see a badge in the app and get a note when they make it.</p>
      <div>
        <span className="label">Remind customers before points expire</span>
        <div className="actions">
          {[30, 14, 7, 3, 1].map((d) => (
            <label key={d} className="check" htmlFor={`s-rem-${d}`} style={{ marginBottom: 0 }}>
              <input id={`s-rem-${d}`} type="checkbox" checked={f.reminder_days.includes(d)} onChange={() => toggleDay(d)} />
              <span>{d === 1 ? "1 day" : `${d} days`}</span>
            </label>
          ))}
        </div>
        <p className="hint">Sent in the Khushi Points app at 10:30 AM, once each. Pick up to 3. Customers can turn reminders off.</p>
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
  const [note, setNote] = useState("");
  const load = () => rpc<Activity[]>("recent_activity", { p_shop: shop.id, p_limit: 50 }).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="panel">
      <h2>Recent activity</h2><p className="sub">The last 50 bills and redemptions. Undo a wrong entry here.</p>
      {note && <div className="msg ok" role="status" style={{ marginBottom: 12 }}>{note}</div>}
      <div className="tbl-wrap"><table>
        <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Bill</th><th className="num">Amount</th><th className="num">Points</th><th></th></tr></thead>
        <tbody>
          {rows?.length === 0 && <tr><td colSpan={7} className="hint">Nothing yet.</td></tr>}
          {rows?.map((t) => (
            <tr key={t.id} className={t.undone ? "undone" : ""}>
              <td>{when(t.created_at)}</td>
              <td><span className={`chip ${t.undone ? "undone" : t.kind}`}>{t.kind === "earn" ? "Earned" : "Redeemed"}</span>{t.undone ? <span className="hint"> Undone</span> : t.method && <span className="hint"> {t.method.toUpperCase()}</span>}</td>
              <td>{t.name}<div className="hint mono">{maskMobile(t.mobile)}</div></td>
              <td className="mono">{t.bill_no ?? ""}</td>
              <td className="num">{inr(t.amount)}</td>
              <td className="num">{t.kind === "earn" ? "+" : "−"}{t.points}</td>
              <td className="num">{!t.undone && <UndoButton shopId={shop.id} txnId={t.id} onDone={(m) => { setNote(`${t.kind === "earn" ? "Bill" : "Redemption"} undone for ${t.name}. ${m}`); load(); }} />}</td>
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

// Billing software (POS) connection: each bill sent here gives points automatically.
function PosConnect({ shop }: { shop: Shop }) {
  const [status, setStatus] = useState<{ hint: string; created_at: string } | null | undefined>(undefined);
  const [key, setKey] = useState("");
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState("");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pos-bill`;
  const load = () => rpc<{ hint: string; created_at: string } | null>("pos_key_status", { p_shop: shop.id }).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function make() {
    if (status && !armed) return setArmed(true);
    setArmed(false);
    try { setKey(await rpc<string>("new_pos_key", { p_shop: shop.id })); load(); } catch { /* owner only */ }
  }
  async function remove() { await rpc("remove_pos_key", { p_shop: shop.id }).catch(() => {}); setKey(""); load(); }
  const copy = (t: string, what: string) => navigator.clipboard?.writeText(t).then(() => setCopied(what)).catch(() => {});
  const sample = JSON.stringify({ mobile: "9848012345", amount: 1250, bill_no: "B-1043", items: "2 Chicken Biryani, 1 Coke" }, null, 2);

  return (
    <div className="panel stack">
      <div><h2>Connect billing software</h2>
        <p className="sub">If your shop uses Petpooja or another billing system, it can send each bill here. The customer gets points and a notification in their app, with no typing at the counter.</p></div>
      {status === undefined ? <p className="hint">Loading…</p> : (
        <>
          <div className="actions">
            <span>{status ? <>Connected · key ending <span className="mono">{status.hint}</span></> : "Not connected"}</span>
            <button className="btn alt small" onClick={make}>{armed ? "Tap again: old key stops working" : status ? "Make a new key" : "Create connection key"}</button>
            {status && <button className="btn danger small" onClick={remove}>Disconnect</button>}
          </div>
          {key && (
            <div className="msg info"><strong>Copy this key now. It is shown only once.</strong>
              <div className="mono" style={{ wordBreak: "break-all", margin: "6px 0" }}>{key}</div>
              <button className="btn alt small" onClick={() => copy(key, "key")}>{copied === "key" ? "Copied" : "Copy key"}</button></div>
          )}
          <details className="extra">
            <summary>Details for your billing software provider</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <p className="hint">Send a POST request for every bill to:</p>
              <div className="mono" style={{ wordBreak: "break-all" }}>{url}</div>
              <p className="hint">With the header <span className="mono">x-api-key: (your key)</span> and a JSON body like:</p>
              <pre className="mono" style={{ background: "var(--sunk)", padding: 10, borderRadius: 8, overflowX: "auto", margin: 0 }}>{sample}</pre>
              <button className="btn alt small" onClick={() => copy(`POST ${url}\nx-api-key: <key>\n\n${sample}`, "details")}>{copied === "details" ? "Copied" : "Copy details"}</button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

// Square shop picture shown to customers. Resized in the browser to 512x512 before upload.
function LogoPicker({ shop }: { shop: Shop }) {
  const { updateShop } = useShop();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const url = logoUrl(shop.logo_path);

  async function pick(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (!file.type.startsWith("image/")) return setMsg({ kind: "err", text: "Choose a photo or image file." });
    setBusy(true);
    try {
      const blob = await squareJpeg(file, 512);
      const path = `${shop.id}/logo-${Date.now()}.jpg`;
      const up = await supabase.storage.from("shop-logos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (up.error) throw up.error;
      const s = await rpc<Shop>("set_shop_logo", { p_shop: shop.id, p_path: path });
      if (shop.logo_path) await supabase.storage.from("shop-logos").remove([shop.logo_path]);
      updateShop(s);
      setMsg({ kind: "ok", text: "Logo saved. Customers see it in the app." });
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg(null);
    try {
      const s = await rpc<Shop>("set_shop_logo", { p_shop: shop.id, p_path: null });
      if (shop.logo_path) await supabase.storage.from("shop-logos").remove([shop.logo_path]);
      updateShop(s);
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); } finally { setBusy(false); }
  }

  return (
    <div>
      <span className="label">Logo or shop photo</span>
      <div className="logo-pick">
        <div className="logo-preview">{url ? <img src={url} alt={`${shop.name} logo`} /> : <span>{shop.name.trim().charAt(0).toUpperCase()}</span>}</div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="actions">
            <label className="btn alt small" style={{ margin: 0, textTransform: "none", letterSpacing: 0 }}>
              {busy ? "Saving…" : url ? "Change picture" : "Add picture"}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {url && <button type="button" className="btn link small" onClick={remove} disabled={busy}>Remove</button>}
          </div>
          <span className="hint">A square picture works best. Customers see it next to your shop in the app.</span>
        </div>
      </div>
      {msg && <div className={`msg ${msg.kind}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

// Crops the middle square of an image and shrinks it, so uploads stay small.
async function squareJpeg(file: File, size: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  img.close();
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("BAD_LOGO"))), "image/jpeg", 0.85));
}

// Owner deletes the whole shop. They must type its name first.
function DeleteShop({ shop }: { shop: Shop }) {
  const { reload } = useShop();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const matches = name.trim().toLowerCase() === shop.name.trim().toLowerCase();

  async function del(e: FormEvent) {
    e.preventDefault(); setErr("");
    if (!matches) return setErr(errorText("CONFIRM_NAME"));
    setBusy(true);
    try {
      if (shop.logo_path) await supabase.storage.from("shop-logos").remove([shop.logo_path]);
      await rpc("delete_shop", { p_shop: shop.id, p_confirm: name });
      await reload();
      navigate("/", { replace: true });
    } catch (e2) { setErr(errorText(e2)); setBusy(false); }
  }
  return (
    <form className="panel stack danger-zone" onSubmit={del} autoComplete="off">
      <div><h2>Delete this shop</h2>
        <p className="sub">Deletes {shop.name} for good: all customers, their points and history, offers, staff and the billing connection. Customers lose their points here. This cannot be undone.</p></div>
      <div><label htmlFor="del-shop">Type <b style={{ textTransform: "none" }}>{shop.name}</b> to confirm</label>
        <input id="del-shop" value={name} onChange={(e) => setName(e.target.value)} placeholder={shop.name} /></div>
      <div className="actions"><button className="btn danger" disabled={!matches || busy}>{busy ? "Deleting…" : "Delete shop for good"}</button></div>
      {err && <div className="msg err" role="status">{err}</div>}
    </form>
  );
}

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

// Rewards that are not discounts: unlocked by visits, handed over at the counter.
type RewardRow = { id: number; title: string; details: string; trigger: "visits" | "regular"; every_visits: number | null;
  active: boolean; unlocked_30d: number; given_30d: number; waiting: number };

function Rewards({ shop }: { shop: Shop }) {
  const [list, setList] = useState<RewardRow[]>([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [trigger, setTrigger] = useState<"visits" | "regular">("visits");
  const [every, setEvery] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const load = () => rpc<RewardRow[]>("shop_rewards", { p_shop: shop.id }).then(setList).catch(() => {});
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const n = Number(every);
    if (trigger === "visits" && (!Number.isInteger(n) || n < 2 || n > 50)) return setMsg({ kind: "err", text: "Choose a number of visits from 2 to 50." });
    setBusy(true);
    try {
      await rpc("add_reward", { p_shop: shop.id, p_title: title, p_details: details, p_trigger: trigger, p_every: trigger === "visits" ? n : null });
      setMsg({ kind: "ok", text: "Reward added. Customers see it in the app and unlock it from their next visit." });
      setTitle(""); setDetails(""); load();
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); } finally { setBusy(false); }
  }
  async function toggle(r: RewardRow) {
    try { await rpc("update_reward", { p_shop: shop.id, p_reward: r.id, p_title: r.title, p_details: r.details, p_active: !r.active }); load(); }
    catch (err) { setMsg({ kind: "err", text: errorText(err) }); }
  }
  async function remove(r: RewardRow) {
    if (!window.confirm(`Remove "${r.title}"? Customers who already unlocked it can still collect it.`)) return;
    try { await rpc("remove_reward", { p_shop: shop.id, p_reward: r.id }); load(); }
    catch (err) { setMsg({ kind: "err", text: errorText(err) }); }
  }
  const when_ = (r: RewardRow) => r.trigger === "visits" ? `Every ${ordinal(r.every_visits ?? 0)} visit` : `When a customer becomes a Regular (${shop.regular_visits ?? 5} visits in 90 days)`;

  return (
    <div className="panel stack">
      <div><h2>Rewards</h2><p className="sub">Thank-yous that bring customers back without giving away money: a free chai, a sample, a small gift. Customers unlock them by visiting; your cashier hands them over at the counter.</p></div>
      {list.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          {list.map((r) => (
            <div className={`offer-card${r.active ? "" : " removed"}`} key={r.id}>
              <div className="offer-top">
                <div style={{ minWidth: 0 }}><div className="offer-title">{r.title}</div><div className="hint">{when_(r)}{r.details ? ` · ${r.details}` : ""}</div></div>
                <span className={`chip${r.active ? " earn" : ""}`}>{r.active ? "On" : "Paused"}</span>
              </div>
              <div className="hint">Last 30 days: {r.unlocked_30d} unlocked · {r.given_30d} given · {r.waiting} waiting to be collected</div>
              <div className="actions">
                <button type="button" className="btn alt small" onClick={() => toggle(r)}>{r.active ? "Pause" : "Turn on"}</button>
                <button type="button" className="btn link small" style={{ color: "var(--bad)" }} onClick={() => remove(r)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.length < 5 && (
        <form className="stack" onSubmit={add} autoComplete="off">
          <span className="label">{list.length ? "Add another reward" : "Add your first reward"}</span>
          <div><label htmlFor="r-title">Reward</label><input id="r-title" required minLength={2} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Free masala chai" /></div>
          <div className="row">
            <div><label htmlFor="r-when">Customers get it</label>
              <select id="r-when" value={trigger} onChange={(e) => setTrigger(e.target.value as "visits" | "regular")}>
                <option value="visits">Every few visits</option><option value="regular">When they become a Regular</option>
              </select></div>
            {trigger === "visits" && <div><label htmlFor="r-every">Every how many visits</label><input id="r-every" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></div>}
          </div>
          <div><label htmlFor="r-details">Details (optional)</label><input id="r-details" maxLength={200} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Any size. Dine-in or takeaway." /></div>
          <div className="actions"><button className="btn" disabled={busy}>{busy ? "Adding…" : "Add reward"}</button></div>
        </form>
      )}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      <p className="hint" style={{ margin: 0 }}>A visit is a day with a bill. Unlocked rewards stay valid for 60 days. Undoing a bill takes back a reward it unlocked, if not yet given.</p>
    </div>
  );
}

// Win-back: one note to customers who have not been back in 30-120 days, optionally with a gift.
type WinPreview = { lapsed: number; reachable: number; not_reachable: number; next_allowed: string | null;
  people: { name: string; mobile: string | null; last_visit: string; visits: number }[] };
type WinPast = { id: number; message: string; gift_title: string | null; created_at: string; recipients: number; came_back: number };

function WinBack({ shop }: { shop: Shop }) {
  const [p, setP] = useState<WinPreview | null>(null);
  const [past, setPast] = useState<WinPast[]>([]);
  const [rewards, setRewards] = useState<{ id: number; title: string }[]>([]);
  const [message, setMessage] = useState(`We miss you at ${shop.name}! Drop by this week, we'd love to see you again.`);
  const [gift, setGift] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const load = () => {
    rpc<WinPreview>("winback_preview", { p_shop: shop.id }).then(setP).catch(() => {});
    rpc<WinPast[]>("shop_winbacks", { p_shop: shop.id }).then(setPast).catch(() => {});
    rpc<{ id: number; title: string }[]>("shop_rewards", { p_shop: shop.id }).then(setRewards).catch(() => {});
  };
  useEffect(() => { load(); }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await rpc<{ winback_id: number; recipients: number }>("send_winback", { p_shop: shop.id, p_message: message, p_reward: gift ? Number(gift) : null });
      const { data } = await supabase.functions.invoke("push", { body: { action: "winback", shop_id: shop.id, winback_id: r.winback_id } });
      setMsg({ kind: "ok", text: `Note sent to ${r.recipients} customer${r.recipients === 1 ? "" : "s"}${data?.devices ? ` (${data.devices} phone${data.devices === 1 ? "" : "s"})` : ""}.` });
      load();
    } catch (err) { setMsg({ kind: "err", text: errorText(err) }); } finally { setBusy(false); }
  }
  const waitUntil = p?.next_allowed ? new Date(p.next_allowed) : null;

  return (
    <div className="panel stack">
      <div><h2>Bring customers back</h2>
        <p className="sub">Send one personal note to customers who have not visited in 30 days. It arrives in their Khushi Points app. Each customer gets at most one note every 60 days, and you can send once a week.</p></div>
      {p && (
        <div className="kpis">
          <div className="kpi"><div className="k">Not back in 30 days</div><div className="v">{p.lapsed}</div><div className="n">Last visit 30 to 120 days ago</div></div>
          <div className="kpi"><div className="k">A note reaches</div><div className="v">{p.reachable}</div><div className="n">{p.not_reachable} don't use the app or had a note recently</div></div>
        </div>
      )}
      {p && p.people.length > 0 && (
        <details className="extra">
          <summary>See who ({p.people.length}{p.reachable > p.people.length ? ` of ${p.reachable}` : ""})</summary>
          <div className="tbl-wrap"><table><thead><tr><th>Customer</th><th>Mobile</th><th className="num">Visits</th><th>Last visit</th></tr></thead>
            <tbody>{p.people.map((x, i) => <tr key={i}><td>{x.name}</td><td className="mono">{maskMobile(x.mobile)}</td><td className="num">{x.visits}</td><td className="hint">{when(x.last_visit)}</td></tr>)}</tbody></table></div>
        </details>
      )}
      <form className="stack" onSubmit={send} autoComplete="off">
        <div><label htmlFor="w-msg">Your note</label><textarea id="w-msg" rows={2} minLength={5} maxLength={200} required value={message} onChange={(e) => setMessage(e.target.value)} />
          <p className="hint" style={{ margin: "6px 0 0" }}>{message.length}/200. Keep it warm and personal. No discounts needed.</p></div>
        <div><label htmlFor="w-gift">Welcome-back gift (optional)</label>
          <select id="w-gift" value={gift} onChange={(e) => setGift(e.target.value)}>
            <option value="">No gift, just the note</option>
            {rewards.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <p className="hint" style={{ margin: "6px 0 0" }}>{rewards.length ? "They can collect it at the counter within 60 days." : "Add a reward in the Rewards section to offer it as a gift."}</p></div>
        <div className="actions">
          <button className="btn" disabled={busy || !p?.reachable || !!waitUntil}>{busy ? "Sending…" : `Send note${p?.reachable ? ` to ${p.reachable}` : ""}`}</button>
          {waitUntil && <span className="hint">Next note possible {waitUntil.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
          {p && !p.reachable && !waitUntil && <span className="hint">Nobody to send to right now.</span>}
        </div>
      </form>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      {past.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">Notes sent</span>
          {past.map((w) => (
            <div className="offer-card" key={w.id}>
              <div className="offer-top"><div className="offer-title" style={{ fontWeight: 600 }}>{w.message}</div>
                <span className="chip earn">{w.came_back} of {w.recipients} came back</span></div>
              <div className="hint">{when(w.created_at)}{w.gift_title ? ` · gift: ${w.gift_title}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
