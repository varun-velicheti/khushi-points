import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { errorText, rpc, when } from "../lib";
import { useShop } from "../shop";
import { useBiz } from "./BizApp";
import type { Item } from "./api";
import { rupees } from "./money";

const RATES = [0, 5, 12, 18, 28];

// Owner setup: menu, tables, stock, billing details.
export default function Setup() {
  const { menu } = useBiz();
  const low = menu.items.filter((i) => i.track_stock && Number(i.stock) <= Number(i.low_stock ?? 5)).length;
  return (
    <div className="biz-pad setup">
      <nav className="pills">
        <NavLink to="/biz/setup/menu">{({ isActive }) => <button aria-pressed={isActive}>Menu</button>}</NavLink>
        {menu.shop.use_tables !== false && <NavLink to="/biz/setup/tables">{({ isActive }) => <button aria-pressed={isActive}>Tables</button>}</NavLink>}
        <NavLink to="/biz/setup/stock">{({ isActive }) => <button aria-pressed={isActive}>Stock{low > 0 && <span className="pill-badge">{low}</span>}</button>}</NavLink>
        <NavLink to="/biz/setup/staff">{({ isActive }) => <button aria-pressed={isActive}>Staff</button>}</NavLink>
        <NavLink to="/biz/setup/billing">{({ isActive }) => <button aria-pressed={isActive}>Billing</button>}</NavLink>
      </nav>
      <Routes>
        <Route path="menu" element={<MenuSetup />} />
        <Route path="tables" element={<TablesSetup />} />
        <Route path="stock" element={<StockSetup />} />
        <Route path="staff" element={<StaffSetup />} />
        <Route path="billing" element={<BillingSetup />} />
        <Route path="*" element={<Navigate to="menu" replace />} />
      </Routes>
    </div>
  );
}

function useCall() {
  const { current } = useShop();
  const { reload } = useBiz();
  const [err, setErr] = useState("");
  const call = async (fn: string, args: Record<string, unknown>) => {
    setErr("");
    try { await rpc(fn, { p_shop: current!.shop.id, ...args }); await reload(); return true; }
    catch (e) { setErr(errorText(e)); return false; }
  };
  return { call, err };
}

/* ---------------------------------------------------------------- menu */

// An option group is typed as one line of choices: "Small, Large +15, Jumbo +25".
type OptDraft = { name: string; pick: "one" | "many"; text: string };
type Draft = { id?: string; name: string; price: string; gst_rate: number; category_id: string; veg: boolean; available: boolean; options: OptDraft[] };
const blank = (cat = ""): Draft => ({ name: "", price: "", gst_rate: 5, category_id: cat, veg: true, available: true, options: [] });
const toDraft = (i: Item): Draft => ({ id: i.id, name: i.name, price: String(i.price), gst_rate: Number(i.gst_rate), category_id: i.category_id ?? "", veg: i.veg, available: i.available,
  options: (i.options ?? []).map((g) => ({ name: g.name, pick: g.pick, text: g.choices.map((c) => (Number(c.price) > 0 ? `${c.name} +${Number(c.price)}` : c.name)).join(", ") })) });
const parseOptions = (o: OptDraft[]) => o.filter((g) => g.name.trim() && g.text.trim()).map((g) => ({
  name: g.name.trim(), pick: g.pick,
  choices: g.text.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*\+\s*₹?\s*(\d+(?:\.\d+)?)$/);
    return m ? { name: m[1].trim(), price: Number(m[2]) } : { name: s, price: 0 };
  }),
}));

function MenuSetup() {
  const { menu } = useBiz();
  const { call, err } = useCall();
  const [newCat, setNewCat] = useState("");
  const [draft, setDraft] = useState<Draft>(blank(menu.categories[0]?.id));
  const [editing, setEditing] = useState<Draft | null>(null);

  async function addCat(e: FormEvent) {
    e.preventDefault();
    if (await call("biz_save_category", { p_id: null, p_name: newCat, p_sort: menu.categories.length + 1 })) setNewCat("");
  }
  const save = (d: Draft) => call("biz_save_item", { p: { ...d, price: Number(d.price), category_id: d.category_id || null, options: parseOptions(d.options) } });
  async function add(e: FormEvent) {
    e.preventDefault();
    if (await save(draft)) setDraft(blank(draft.category_id));
  }
  const groups = [...menu.categories.map((c) => ({ id: c.id, name: c.name })), { id: "", name: "No category" }]
    .map((g) => ({ ...g, items: menu.items.filter((i) => (i.category_id ?? "") === g.id) }))
    .filter((g) => g.items.length || g.id);

  return (
    <div className="stack">
      <div className="chips">
        {menu.categories.map((c) => (
          <span className="chip-edit" key={c.id}>
            <button onClick={() => { const n = window.prompt("Category name", c.name); if (n) call("biz_save_category", { p_id: c.id, p_name: n, p_sort: c.sort }); }}>{c.name}</button>
            <button aria-label={`Delete ${c.name}`} onClick={() => window.confirm(`Delete ${c.name}? Its items stay.`) && call("biz_delete_category", { p_id: c.id })}>×</button>
          </span>
        ))}
        <form onSubmit={addCat} className="chip-add"><input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" maxLength={40} /><button className="btn small" disabled={!newCat.trim()}>Add</button></form>
      </div>

      <form className="item-form" onSubmit={add}>
        <ItemFields d={draft} set={setDraft} />
        <button className="btn" disabled={!draft.name.trim() || draft.price === ""}>Add item</button>
      </form>
      {err && <div className="msg err">{err}</div>}

      {groups.map((g) => (
        <section key={g.id || "none"} className="menu-group">
          <h3>{g.name}</h3>
          {g.items.map((i) => editing?.id === i.id ? (
            <form key={i.id} className="item-form editing" onSubmit={async (e) => { e.preventDefault(); if (await save(editing)) setEditing(null); }}>
              <ItemFields d={editing} set={setEditing as (d: Draft) => void} />
              <button className="btn">Save</button>
              <button type="button" className="btn alt" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn link small del" onClick={async () => { if (window.confirm(`Remove ${i.name}?`) && await call("biz_archive_item", { p_id: i.id })) setEditing(null); }}>Remove</button>
            </form>
          ) : (
            <button key={i.id} className={`menu-row${i.available ? "" : " out"}`} onClick={() => setEditing(toDraft(i))}>
              <span className={`dot ${i.veg ? "veg" : "nonveg"}`} />
              <span className="menu-name">{i.name}{i.options?.length ? <small>{i.options.map((g) => g.name).join(" · ")}</small> : null}</span>
              <span className="menu-gst">{Number(i.gst_rate)}%</span>
              <span className="menu-price">{rupees(i.price)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function ItemFields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
  const { menu } = useBiz();
  return <>
    <input aria-label="Item name" placeholder="Item" value={d.name} maxLength={60} onChange={(e) => set({ ...d, name: e.target.value })} />
    <input aria-label="Price" placeholder="₹" inputMode="decimal" value={d.price} onChange={(e) => set({ ...d, price: e.target.value.replace(/[^\d.]/g, "") })} className="w-price" />
    <select aria-label="GST" value={d.gst_rate} onChange={(e) => set({ ...d, gst_rate: Number(e.target.value) })} className="w-gst">
      {RATES.map((r) => <option key={r} value={r}>{r}% GST</option>)}
    </select>
    <select aria-label="Category" value={d.category_id} onChange={(e) => set({ ...d, category_id: e.target.value })}>
      <option value="">No category</option>
      {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
    <button type="button" className={`veg-toggle ${d.veg ? "veg" : "nonveg"}`} onClick={() => set({ ...d, veg: !d.veg })}>{d.veg ? "Veg" : "Non-veg"}</button>
    <div className="opt-edit">
      {d.options.map((g, k) => {
        const put = (x: Partial<OptDraft>) => set({ ...d, options: d.options.map((y, j) => (j === k ? { ...y, ...x } : y)) });
        return (
          <div className="opt-row" key={k}>
            <input aria-label="Option name" placeholder="Size" value={g.name} maxLength={30} onChange={(e) => put({ name: e.target.value })} />
            <select aria-label="How many can be picked" value={g.pick} onChange={(e) => put({ pick: e.target.value as OptDraft["pick"] })}>
              <option value="one">Pick one</option><option value="many">Pick any</option>
            </select>
            <input aria-label="Choices" placeholder="Small, Large +15" value={g.text} onChange={(e) => put({ text: e.target.value })} />
            <button type="button" className="btn link small" aria-label="Remove option" onClick={() => set({ ...d, options: d.options.filter((_, j) => j !== k) })}>×</button>
          </div>
        );
      })}
      {d.options.length < 6 && <button type="button" className="btn link small" onClick={() => set({ ...d, options: [...d.options, { name: "", pick: "one", text: "" }] })}>+ Options</button>}
    </div>
  </>;
}

/* ---------------------------------------------------------------- staff */

// Staff PINs for a shared counter device. Managers approve voids, refunds and reports.
type StaffDraft = { id?: string; name: string; role: "cashier" | "manager"; pin: string };
function StaffSetup() {
  const { menu } = useBiz();
  const { call, err } = useCall();
  const [d, setD] = useState<StaffDraft>({ name: "", role: "cashier", pin: "" });
  const [editing, setEditing] = useState<StaffDraft | null>(null);
  const save = (x: StaffDraft) => call("biz_staff_save", { p: { ...x, pin: x.pin || null } });
  const fields = (x: StaffDraft, set: (x: StaffDraft) => void, isNew: boolean) => <>
    <input aria-label="Name" placeholder="Name" value={x.name} maxLength={40} onChange={(e) => set({ ...x, name: e.target.value })} />
    <select aria-label="Role" value={x.role} onChange={(e) => set({ ...x, role: e.target.value as StaffDraft["role"] })} className="w-gst">
      <option value="cashier">Cashier</option><option value="manager">Manager</option>
    </select>
    <input aria-label="PIN" placeholder={isNew ? "PIN" : "New PIN"} inputMode="numeric" maxLength={6} value={x.pin} className="w-price"
      onChange={(e) => set({ ...x, pin: e.target.value.replace(/\D/g, "") })} />
  </>;
  return (
    <div className="stack">
      <form className="item-form" onSubmit={async (e) => { e.preventDefault(); if (await save(d)) setD({ name: "", role: "cashier", pin: "" }); }}>
        {fields(d, setD, true)}
        <button className="btn" disabled={!d.name.trim() || d.pin.length < 4}>Add</button>
      </form>
      {err && <div className="msg err">{err}</div>}
      <section className="menu-group">
        {(menu.staff ?? []).map((s) => editing?.id === s.id ? (
          <form key={s.id} className="item-form editing" onSubmit={async (e) => { e.preventDefault(); if (await save(editing)) setEditing(null); }}>
            {fields(editing, setEditing as (x: StaffDraft) => void, false)}
            <button className="btn">Save</button>
            <button type="button" className="btn alt" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn link small del" onClick={async () => { if (window.confirm(`Remove ${s.name}?`) && await call("biz_staff_remove", { p_id: s.id })) setEditing(null); }}>Remove</button>
          </form>
        ) : (
          <button key={s.id} className="menu-row staff-row" onClick={() => setEditing({ id: s.id, name: s.name, role: s.role, pin: "" })}>
            <span className="menu-name">{s.name}</span><span className="menu-gst">{s.role === "manager" ? "Manager" : "Cashier"}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- tables */

function TablesSetup() {
  const { menu } = useBiz();
  const { call, err } = useCall();
  const [name, setName] = useState("");
  async function add(e: FormEvent) {
    e.preventDefault();
    if (await call("biz_save_table", { p_id: null, p_name: name, p_sort: menu.tables.length + 1 })) setName("");
  }
  async function addTen() {
    for (let i = 1; i <= 10; i++) await call("biz_save_table", { p_id: null, p_name: `T${i}`, p_sort: i });
  }
  return (
    <div className="stack">
      <div className="floor">
        {menu.tables.map((t) => (
          <div key={t.id} className="tile">
            <span className="tile-name">{t.name}</span>
            <span className="tile-actions">
              <button className="btn link small" onClick={() => { const n = window.prompt("Table name", t.name); if (n) call("biz_save_table", { p_id: t.id, p_name: n, p_sort: t.sort }); }}>Rename</button>
              <button className="btn link small del" onClick={() => window.confirm(`Remove ${t.name}?`) && call("biz_archive_table", { p_id: t.id })}>Remove</button>
            </span>
          </div>
        ))}
        <form className="tile tile-new" onSubmit={add}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Table name" maxLength={20} />
          <button className="btn small" disabled={!name.trim()}>Add</button>
        </form>
      </div>
      {menu.tables.length === 0 && <button className="btn alt" onClick={addTen}>Add T1 to T10</button>}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- billing */

function BillingSetup() {
  const { menu } = useBiz();
  const { call, err } = useCall();
  const s = menu.shop;
  const [f, setF] = useState({ legal_name: s.legal_name ?? "", gstin: s.gstin ?? "", upi_id: s.upi_id ?? "", gst_inclusive: s.gst_inclusive, kitchen: s.kitchen, use_tables: s.use_tables !== false });
  const [ok, setOk] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setOk(false);
    if (await call("biz_save_settings", { p: f })) setOk(true);
  }
  return (
    <form className="panel stack billing" onSubmit={save}>
      <div><label htmlFor="bs-name">Business name on invoice</label><input id="bs-name" value={f.legal_name} maxLength={100} placeholder={s.name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></div>
      <div className="row">
        <div><label htmlFor="bs-gst">GSTIN</label><input id="bs-gst" className="mono" value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
        <div><label htmlFor="bs-upi">UPI ID</label><input id="bs-upi" className="mono" value={f.upi_id} placeholder="shop@okhdfc" onChange={(e) => setF({ ...f, upi_id: e.target.value.trim() })} /></div>
      </div>
      <div className="pay-modes" role="group" aria-label="Menu prices">
        <button type="button" aria-pressed={f.gst_inclusive} onClick={() => setF({ ...f, gst_inclusive: true })}>Prices include GST</button>
        <button type="button" aria-pressed={!f.gst_inclusive} onClick={() => setF({ ...f, gst_inclusive: false })}>GST added on top</button>
      </div>
      <label className="switch" htmlFor="bs-tables">
        <span>Tables</span>
        <input id="bs-tables" type="checkbox" role="switch" checked={f.use_tables} onChange={(e) => setF({ ...f, use_tables: e.target.checked })} />
      </label>
      <label className="switch" htmlFor="bs-kitchen">
        <span>Kitchen screen</span>
        <input id="bs-kitchen" type="checkbox" role="switch" checked={f.kitchen} onChange={(e) => setF({ ...f, kitchen: e.target.checked })} />
      </label>
      <div className="actions"><button className="btn">Save</button>{ok && <span className="hint">Saved</span>}</div>
      {err && <div className="msg err">{err}</div>}
    </form>
  );
}

/* ---------------------------------------------------------------- stock */

type StockItem = { id: string; name: string; track_stock: boolean; stock: number; low_stock: number };
type Move = { name: string; change: number; reason: "sale" | "add" | "count" | "void"; at: string; by: string | null };
const qtyText = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function StockSetup() {
  const { current } = useShop();
  const { reload } = useBiz();
  const shopId = current!.shop.id;
  const [data, setData] = useState<{ items: StockItem[]; moves: Move[] } | null>(null);
  const [add, setAdd] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => rpc<{ items: StockItem[]; moves: Move[] }>("biz_stock", { p_shop: shopId }).then(setData).catch((e) => setErr(errorText(e))), [shopId]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: string, args: Record<string, unknown>) => {
    setErr("");
    try { await rpc(fn, { p_shop: shopId, ...args }); await load(); reload(); } catch (e) { setErr(errorText(e)); }
  };
  if (!data) return <p className="hint">Loading…</p>;
  const tracked = data.items.filter((i) => i.track_stock), others = data.items.filter((i) => !i.track_stock);

  return (
    <div className="stack">
      {err && <div className="msg err">{err}</div>}
      <section className="menu-group">
        {tracked.map((i) => (
          <div key={i.id} className={`stock-row${Number(i.stock) <= Number(i.low_stock) ? " low" : ""}`}>
            <span className="menu-name">{i.name}</span>
            <button className="stock-count"
              onClick={() => { const n = window.prompt(`${i.name}: how many on the shelf now?`, qtyText(i.stock)); if (n !== null && n.trim() !== "") run("biz_stock_count", { p_item: i.id, p_count: Number(n) }); }}>
              {qtyText(i.stock)}
            </button>
            <form className="stock-add" onSubmit={(e) => { e.preventDefault(); const q = Number(add[i.id]); if (q) { run("biz_stock_add", { p_item: i.id, p_qty: q }); setAdd({ ...add, [i.id]: "" }); } }}>
              <input aria-label={`Quantity of ${i.name} to add`} inputMode="decimal" placeholder="Qty" value={add[i.id] ?? ""}
                onChange={(e) => setAdd({ ...add, [i.id]: e.target.value.replace(/[^\d.-]/g, "") })} />
              <button className="btn small" disabled={!Number(add[i.id])}>Add</button>
            </form>
            <button className="btn link small low-at" onClick={() => { const n = window.prompt(`${i.name}: show as low at or below`, qtyText(i.low_stock)); if (n !== null && n.trim() !== "" && Number(n) >= 0) run("biz_stock_low", { p_item: i.id, p_low: Number(n) }); }}>Low ≤ {qtyText(i.low_stock)}</button>
            <button className="btn link small" onClick={() => run("biz_stock_track", { p_item: i.id, p_on: false })}>Stop</button>
          </div>
        ))}
      </section>
      {others.length > 0 && (
        <details className="extra" open={tracked.length === 0}>
          <summary>Count stock for more items</summary>
          <div className="chips" style={{ marginTop: 10 }}>
            {others.map((i) => <button key={i.id} className="chip-pick" onClick={() => run("biz_stock_track", { p_item: i.id, p_on: true })}>+ {i.name}</button>)}
          </div>
        </details>
      )}
      {data.moves.length > 0 && (
        <section className="menu-group">
          <h3>Recent changes</h3>
          <div className="tbl-wrap"><table><tbody>
            {data.moves.map((m, k) => (
              <tr key={k}><td className="hint">{when(m.at)}</td><td>{m.name}</td>
                <td className="num" style={{ color: m.change < 0 ? "var(--bad)" : "var(--good)" }}>{m.change > 0 ? "+" : ""}{qtyText(m.change)}</td>
                <td className="hint">{m.reason === "sale" ? "Sold" : m.reason === "add" ? "Added" : m.reason === "void" ? "Bill voided" : "Counted"}{m.by ? ` · ${m.by}` : ""}</td></tr>
            ))}
          </tbody></table></div>
        </section>
      )}
    </div>
  );
}
