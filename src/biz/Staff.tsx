import { useEffect, useState } from "react";
import { errorText, rpc } from "../lib";
import { isNetworkError } from "./offline";
import type { Staff } from "./api";
import { rupees } from "./money";

// Who is at this device. Kept on the device; a PIN says who it is.
const meKey = (shop: string) => `kb:${shop}:staff`;
const pinsKey = (shop: string) => `kb:${shop}:pins`;
function read<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function write(k: string, v: unknown) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } }
export const savedStaff = (shop: string) => read<Staff | null>(meKey(shop), null);
export const saveStaff = (shop: string, s: Staff | null) => write(meKey(shop), s);

// A PIN checked online is remembered on this device only as a hash, so the same person can sign in offline.
async function hash(shop: string, pin: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kushly:${shop}:${pin}`));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
type Check = { staff: Staff; approval: string | null };
export async function checkPin(shop: string, pin: string, staffList: Staff[]): Promise<Check> {
  try {
    const r = await rpc<{ ok: boolean; error?: string; id: string; name: string; role: Staff["role"]; approval: string | null }>("biz_staff_check", { p_shop: shop, p_pin: pin });
    if (!r.ok) throw new Error(r.error ?? "WRONG_PIN");
    const staff = { id: r.id, name: r.name, role: r.role };
    write(pinsKey(shop), { ...read<Record<string, string>>(pinsKey(shop), {}), [await hash(shop, pin)]: staff.id });
    return { staff, approval: r.approval };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const id = read<Record<string, string>>(pinsKey(shop), {})[await hash(shop, pin)];
    const staff = staffList.find((s) => s.id === id);
    if (!staff) throw new Error("PIN_OFFLINE");
    return { staff, approval: null };
  }
}

// Number pad for a 4–6 digit PIN. Enter sends it; 6 digits send it straight away.
export function PinPad({ title, onPin, error, busy }: { title: string; onPin: (pin: string) => void; error?: string; busy?: boolean }) {
  const [pin, setPin] = useState("");
  useEffect(() => { if (error) setPin(""); }, [error]);
  const press = (d: string) => { if (busy) return; const p = (pin + d).slice(0, 6); setPin(p); if (p.length === 6) onPin(p); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) onPin(pin);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  return (
    <div className="pinpad">
      <b>{title}</b>
      <div className="pin-dots" aria-label={`${pin.length} digits entered`}>{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} className={i < pin.length ? "on" : i >= 4 ? "opt" : ""} />)}</div>
      {error && <div className="msg err">{error}</div>}
      <div className="pin-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button type="button" key={d} onClick={() => press(d)}>{d}</button>)}
        <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete">⌫</button>
        <button type="button" onClick={() => press("0")}>0</button>
        <button type="button" className="go" disabled={pin.length < 4 || busy} onClick={() => onPin(pin)} aria-label="Enter">→</button>
      </div>
    </div>
  );
}

// Full screen until someone enters their PIN.
export function Lock({ shop, staffList, onIn }: { shop: string; staffList: Staff[]; onIn: (s: Staff) => void }) {
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function go(pin: string) {
    setBusy(true); setErr("");
    try { onIn((await checkPin(shop, pin, staffList)).staff); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="lock"><PinPad title="Enter your PIN" onPin={go} error={err} busy={busy} /></div>;
}

// A manager's PIN for one action (void, refund, reports). Gives the approval token or nothing.
export function ManagerPin({ shop, staffList, onDone }: { shop: string; staffList: Staff[]; onDone: (approval: string | null) => void }) {
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function go(pin: string) {
    setBusy(true); setErr("");
    try {
      const r = await checkPin(shop, pin, staffList);
      if (r.staff.role !== "manager") setErr(errorText("MANAGER_ONLY"));
      else if (!r.approval) setErr(errorText("NEEDS_INTERNET"));
      else onDone(r.approval);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="sheet-bg" onClick={() => onDone(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header><span /><button type="button" className="btn link small" onClick={() => onDone(null)}>Close</button></header>
        <PinPad title="Manager PIN" onPin={go} error={err} busy={busy} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cash shift

type ShiftRow = { id: string; opened_at: string; opened_by: string | null; float: number; cash_sales: number; cash_refunds: number; expected: number;
  closed_at: string | null; closed_by: string | null; counted: number | null; difference: number | null; note: string | null };
const time = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const diffText = (d: number) => (d === 0 ? "Exact" : d > 0 ? `${rupees(d)} over` : `${rupees(-d)} short`);

// Open the drawer with a float; close it with the cash counted. Expected = float + cash taken − cash refunded.
export function Shift({ shop, staff, onClose }: { shop: string; staff: Staff | null; onClose: () => void }) {
  const [data, setData] = useState<{ open: ShiftRow | null; recent: ShiftRow[] } | null>(null);
  const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [newId] = useState(() => crypto.randomUUID());
  useEffect(() => { rpc<typeof data>("biz_shifts", { p_shop: shop }).then(setData).catch((e) => setErr(errorText(e))); }, [shop]);
  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr("");
    try { setData(await rpc<typeof data>(fn, { p_shop: shop, ...args, p_staff: staff?.id ?? null })); setAmount(""); setNote(""); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  const o = data?.open, last = data?.recent[0];
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet shift" onClick={(e) => e.stopPropagation()}>
        <header><b>Cash</b><button type="button" className="btn link small" onClick={onClose}>Close</button></header>
        {!data ? <p className="hint">{err || "Loading…"}</p> : o ? <>
          <dl className="shift-sum">
            <dt>Opened</dt><dd>{time(o.opened_at)}{o.opened_by ? ` · ${o.opened_by}` : ""}</dd>
            <dt>Float</dt><dd>{rupees(o.float)}</dd>
            <dt>Cash taken</dt><dd>{rupees(o.cash_sales)}</dd>
            {Number(o.cash_refunds) > 0 && <><dt>Cash refunded</dt><dd>−{rupees(o.cash_refunds)}</dd></>}
            <dt className="grand">Expected in drawer</dt><dd className="grand">{rupees(o.expected)}</dd>
          </dl>
          <input aria-label="Cash counted" placeholder="Cash counted" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <input aria-label="Note" placeholder="Note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn" disabled={busy || amount === ""} onClick={() => run("biz_shift_close", { p_id: o.id, p_counted: Number(amount), p_note: note || null })}>Close shift</button>
        </> : <>
          {last && last.difference !== null && Date.now() - new Date(last.closed_at!).getTime() < 10 * 60000 && (
            <div className={`msg ${last.difference === 0 ? "ok" : "info"}`}>Shift closed · {diffText(Number(last.difference))}</div>
          )}
          <input aria-label="Opening cash" placeholder="Opening cash" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <button type="button" className="btn" disabled={busy || amount === ""} onClick={() => run("biz_shift_open", { p_id: newId, p_float: Number(amount) })}>Open shift</button>
        </>}
        {err && data && <div className="msg err">{err}</div>}
        {data && data.recent.length > 0 && (
          <div className="shift-recent">
            {data.recent.map((s) => (
              <div key={s.id}><span>{time(s.closed_at!)}</span><span>{rupees(s.counted ?? 0)} of {rupees(s.expected)}</span>
                <b className={Number(s.difference) < 0 ? "short" : ""}>{diffText(Number(s.difference))}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
