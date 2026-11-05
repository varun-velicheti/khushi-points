import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { cleanMobile, errorText, fmtMobile, inr, maskMobile, rpc, supabase, validMobile, when, type Shop } from "../lib";
import { useShop } from "../shop";
import UndoButton from "../Undo";
import Scanner from "../Scanner";

type Mode = "earn" | "redeem" | "balance";

type Balance = {
  exists: boolean; has_app?: boolean; name?: string; mobile?: string | null; balance?: number; value?: number; expiring_30d?: number;
  recent?: { kind: string; bill_no: string | null; amount: number; points: number; method: string | null; created_at: string; undone?: boolean; note?: string | null }[];
};

// Who the customer is: a mobile number they say, or the member QR from their app.
type Who = { mobile?: string; member?: string };
const MEMBER_RE = /^(KP:)?K[A-Z0-9]{7}$/i;
function parseWho(raw: string): Who | null {
  const t = raw.trim();
  if (MEMBER_RE.test(t.replace(/\s/g, ""))) return { member: t.replace(/\s/g, "").toUpperCase() };
  const m = cleanMobile(t);
  return validMobile(m) ? { mobile: m } : null;
}
const whoArgs = (w: Who) => ({ p_mobile: w.mobile ?? null, p_member: w.member ?? null });
const whoLabel = (w: Who, b?: Balance | null) =>
  `${b?.name && b.name !== "Customer" ? b.name + " · " : ""}${w.member ? "App member " + w.member.replace(/^KP:/, "") : maskMobile(w.mobile!)}`;

export default function Counter() {
  const { current } = useShop();
  const [params, setParams] = useSearchParams();
  const initial = params.get("balance") ?? "";
  const [mode, setMode] = useState<Mode>(initial ? "balance" : "earn");
  const shop = current!.shop;

  useEffect(() => { if (initial) setParams({}, { replace: true }); }, [initial, setParams]);

  return (
    <div className="page">
      <div className="panel">
        <div className="seg" role="group" aria-label="Counter action">
          {(["earn", "redeem", "balance"] as Mode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "earn" ? "Add bill" : m === "redeem" ? "Redeem" : "Check balance"}
            </button>
          ))}
        </div>
        {mode === "earn" && <Earn shop={shop} />}
        {mode === "redeem" && <Redeem shop={shop} />}
        {mode === "balance" && <BalanceCheck shop={shop} initial={initial} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ customer picker */

function CustomerPicker({ id, value, onChange, shop, onLookup }: {
  id: string; value: string; onChange: (v: string) => void; shop: Shop; onLookup: (w: Who | null, b: Balance | null) => void;
}) {
  const [scan, setScan] = useState(false);
  const who = parseWho(value);
  const key = who ? (who.member ?? who.mobile) : "";

  useEffect(() => {
    onLookup(who, null);
    if (!who) return;
    let stale = false;
    rpc<Balance>("customer_balance", { p_shop: shop.id, ...whoArgs(who) })
      .then((b) => { if (!stale) onLookup(who, b); })
      .catch(() => { if (!stale) onLookup(who, { exists: false }); });
    return () => { stale = true; };
  }, [key, shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const gotScan = useCallback((text: string) => { setScan(false); onChange(text.trim()); }, [onChange]);

  return (
    <div>
      <label htmlFor={id}>Customer mobile or app QR</label>
      <div className="picker">
        <input id={id} className="mono" inputMode="text" autoComplete="off" maxLength={16} value={value}
          onChange={(e) => onChange(e.target.value)} placeholder="98480 12345 or K7PQ2MXA" />
        <button type="button" className="btn alt" onClick={() => setScan(true)}>Scan QR</button>
      </div>
      {scan && <Scanner onResult={gotScan} onClose={() => setScan(false)} />}
    </div>
  );
}

const pointsFor = (shop: Shop, amount: number) =>
  amount >= Number(shop.min_bill) ? Math.floor((amount * Number(shop.earn_pct)) / 100 / Number(shop.point_value)) : 0;

/* ------------------------------------------------------------------ rewards waiting at the counter */

type RewardWaiting = { grant_id: number; title: string; details: string; earned_at: string; expires_at: string; txn_id: number | null };

// Shows the customer's unlocked rewards with a "Give now" button. Reloads when `version` changes.
function RewardsDue({ shop, who, version = 0, newTxn }: { shop: Shop; who: Who; version?: number; newTxn?: number }) {
  const [list, setList] = useState<RewardWaiting[] | null>(null);
  const [given, setGiven] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const key = who.member ?? who.mobile;
  useEffect(() => {
    let stale = false;
    setList(null); setGiven([]); setErr("");
    rpc<RewardWaiting[]>("customer_rewards", { p_shop: shop.id, ...whoArgs(who) })
      .then((r) => { if (!stale) setList(r); }).catch(() => { if (!stale) setList([]); });
    return () => { stale = true; };
  }, [key, shop.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function give(g: RewardWaiting) {
    setErr("");
    try { await rpc("use_reward", { p_shop: shop.id, p_grant: g.grant_id }); setGiven((x) => [...x, g.title]); setList((l) => l?.filter((y) => y.grant_id !== g.grant_id) ?? null); }
    catch (e) { setErr(errorText(e)); }
  }
  if (!list || (list.length === 0 && given.length === 0)) return null;
  return (
    <div className="reward-box" role="status">
      {list.map((g) => (
        <div className="reward-row" key={g.grant_id}>
          <span className="reward-icon" aria-hidden="true">🎁</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{g.txn_id && g.txn_id === newTxn ? "Just unlocked: " : "Reward to give: "}{g.title}</b>
            <div className="hint">{g.details ? `${g.details} · ` : ""}valid until {new Date(g.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
          </div>
          <button type="button" className="btn small" onClick={() => give(g)}>Give now</button>
        </div>
      ))}
      {given.map((t, i) => <div className="hint" key={i}>✓ {t} given</div>)}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ earn */

function Earn({ shop }: { shop: Shop }) {
  const [raw, setRaw] = useState("");
  const [who, setWho] = useState<Who | null>(null);
  const [info, setInfo] = useState<Balance | null>(null);
  const [billNo, setBillNo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err" | "info"; title: string; body?: string; txnId?: number } | null>(null);
  const [lastWho, setLastWho] = useState<Who | null>(null);   // customer of the bill just added, to show rewards it unlocked

  const amt = parseFloat(amount) || 0;
  const pts = pointsFor(shop, amt);
  const isNewByNumber = !!who?.mobile && info?.exists === false && !info?.has_app;
  const onLookup = useCallback((w: Who | null, b: Balance | null) => { setWho(w); setInfo(b); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!who) return setResult({ kind: "err", title: "Who is the customer?", body: "Type their 10-digit mobile number or scan the QR in their app." });
    setBusy(true); setResult(null);
    try {
      const r = await rpc<{ txn_id: number; points: number; bill_points: number; topped_up: boolean; earlier_today: number; earlier_bill: number;
        balance: number; value: number; name: string; is_new: boolean; has_app: boolean }>("add_bill", {
        p_shop: shop.id, ...whoArgs(who), p_bill_no: billNo || null, p_amount: amt, p_name: name || null,
        p_consent: consent, p_note: note || null,
      });
      const appLine = r.has_app ? " It shows in their Khushi Points app now." : " Ask them to install the Khushi Points app to see and use their points.";
      if (r.has_app) supabase.functions.invoke("push", { body: { action: "earn", shop_id: shop.id, txn_id: r.txn_id } }).catch(() => {});
      setResult(r.topped_up
        ? { kind: "ok", txnId: r.txn_id, title: `${r.points} points added · bigger bill today`,
            body: `This ${inr(amt)} bill earns ${r.bill_points} points. ${r.earlier_today} were already given today for the ${inr(r.earlier_bill)} bill, so ${r.points} more were added. Balance ${r.balance} points.${appLine}` }
        : { kind: "ok", txnId: r.txn_id, title: `${r.points} points added${r.is_new ? " · new customer" : ""}`,
            body: `${r.name} now has ${r.balance} points, worth ${inr(r.value)}.${appLine}` });
      setLastWho(who);
      setRaw(""); setBillNo(""); setAmount(""); setNote(""); setName(""); setConsent(false);
    } catch (err) {
      setResult({ kind: "err", title: "Points not added", body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} autoComplete="off">
      <div><h2>Add bill, give points</h2><p className="sub">Scan the customer's app QR, or type their mobile number.</p></div>
      <CustomerPicker id="e-who" value={raw} onChange={setRaw} shop={shop} onLookup={onLookup} />
      {who && info && (
        <div className="who">
          <span>{info.exists ? `${whoLabel(who, info)} · ${info.balance} points` : who.member ? "New to this shop · app member" : "New customer"}</span>
          {info.has_app ? <span className="chip app">Has app</span> : <span className="chip">No app yet</span>}
        </div>
      )}
      {who && info?.exists && <RewardsDue shop={shop} who={who} />}
      {isNewByNumber && <>
        <div><label htmlFor="e-name">Name (optional)</label><input id="e-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <label className="check" htmlFor="e-consent">
          <input id="e-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Customer agrees that {shop.name} keeps their mobile number for loyalty points.</span>
        </label>
      </>}
      <div className="row">
        <div><label htmlFor="e-amt">Bill amount (₹)</label><input id="e-amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1250" /></div>
        <div><label htmlFor="e-bill">Bill number (optional)</label><input id="e-bill" className="mono" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="B-1043" /></div>
      </div>
      <details className="extra">
        <summary>Add items for the customer's receipt</summary>
        <textarea id="e-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 Chicken Biryani, 1 Coke" style={{ marginTop: 8 }} />
      </details>
      <div className="preview">
        <span>{amt && amt < Number(shop.min_bill) ? `Bills under ${inr(shop.min_bill)} earn no points` : `Points for this bill (${Number(shop.earn_pct)}% back)`}</span>
        <b>{pts} pts</b>
      </div>
      <div className="actions"><button className="btn" disabled={busy || (isNewByNumber && !consent)}>{busy ? "Adding…" : "Add points"}</button></div>
      {result && <div className={`msg ${result.kind}`} role="status"><strong>{result.title}</strong>{result.body}</div>}
      {result?.kind === "ok" && result.txnId && lastWho && <RewardsDue shop={shop} who={lastWho} newTxn={result.txnId} version={result.txnId} />}
      {result?.txnId && (
        <div className="actions"><span className="hint">Typed something wrong?</span>
          <UndoButton shopId={shop.id} txnId={result.txnId} label="Undo this bill"
            onDone={(msg) => setResult({ kind: "info", title: "Bill undone", body: msg + " You can enter it again with the right details." })} /></div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ redeem: the customer approves in their app */

type Status = { status: string; error?: string | null; txn_id?: number | null; points: number; discount: number; pay: number; balance: number; expires_at: string };

function Redeem({ shop }: { shop: Shop }) {
  const [raw, setRaw] = useState("");
  const [who, setWho] = useState<Who | null>(null);
  const [info, setInfo] = useState<Balance | null>(null);
  const [bill, setBill] = useState("");
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [req, setReq] = useState<{ id: string; name: string; bill: number } | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [now, setNow] = useState(Date.now());
  const [undone, setUndone] = useState("");
  const onLookup = useCallback((w: Who | null, b: Balance | null) => { setWho(w); setInfo(b); }, []);

  const billAmt = parseFloat(bill) || 0;
  const cap = Math.floor((billAmt * shop.max_redeem_pct) / 100 / Number(shop.point_value));
  const maxPts = Math.min(info?.balance ?? 0, cap);
  useEffect(() => { if (billAmt && info?.exists) setPoints(String(maxPts)); }, [billAmt, info, maxPts]);

  // poll the request until the customer decides or it expires
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!req) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await rpc<Status>("redemption_status", { p_shop: shop.id, p_request: req.id });
        if (stop) return;
        setSt(s); setNow(Date.now());
        if (s.status === "pending") timer.current = window.setTimeout(poll, 2000);
      } catch { if (!stop) timer.current = window.setTimeout(poll, 3000); }
    };
    poll();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; window.clearTimeout(timer.current); window.clearInterval(tick); };
  }, [req, shop.id]);

  async function send(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const p = parseInt(points, 10) || 0;
    if (!who) return setMsg({ kind: "err", text: "Scan the customer's app QR or type their mobile number." });
    if (!info?.exists) return setMsg({ kind: "err", text: errorText("NO_CUSTOMER") });
    if (!info.has_app) return setMsg({ kind: "info", text: errorText("NEEDS_APP") });
    if (!(billAmt > 0)) return setMsg({ kind: "err", text: "Enter today's bill amount." });
    if ((info.balance ?? 0) < shop.min_redeem) return setMsg({ kind: "err", text: `Needs ${shop.min_redeem} points to redeem. Has ${info.balance}.` });
    if (p < shop.min_redeem) return setMsg({ kind: "err", text: `Minimum ${shop.min_redeem} points per redemption.` });
    if (p > maxPts) return setMsg({ kind: "err", text: `At most ${maxPts} points can be used on this bill.` });
    setBusy(true);
    try {
      const r = await rpc<{ request_id: string; name: string }>("start_redemption", {
        p_shop: shop.id, ...whoArgs(who), p_bill_amount: billAmt, p_points: p,
      });
      supabase.functions.invoke("push", { body: { action: "redeem", shop_id: shop.id, request_id: r.request_id } }).catch(() => {});
      setSt(null); setUndone("");
      setReq({ id: r.request_id, name: r.name, bill: billAmt });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (req) await rpc("cancel_redemption", { p_shop: shop.id, p_request: req.id }).catch(() => {});
    setReq(null); setSt(null);
  }
  function restart() { setReq(null); setSt(null); setRaw(""); setBill(""); setPoints(""); setMsg(null); setUndone(""); }

  if (req) {
    const secs = st ? Math.max(0, Math.round((new Date(st.expires_at).getTime() - now) / 1000)) : 120;
    const status = st?.status === "pending" && secs === 0 ? "expired" : st?.status ?? "pending";
    if (status === "done" && st) {
      return (
        <div className="stack">
          <div className="msg ok"><strong>Approved. Give {inr(st.discount)} off.</strong>{req.name} approved in their app.</div>
          <div className="receipt">
            <div className="r"><span>Bill amount</span><span>{inr(req.bill)}</span></div>
            <div className="r"><span>Points discount ({st.points} pts)</span><span>− {inr(st.discount)}</span></div>
            <div className="r tot"><span>Customer pays</span><span>{inr(st.pay)}</span></div>
            <div className="r"><span>Points left</span><span>{st.balance} pts</span></div>
          </div>
          {undone ? <div className="msg info"><strong>Redemption undone</strong>{undone}</div>
            : st.txn_id ? <div className="actions"><span className="hint">Wrong amount?</span>
                <UndoButton shopId={shop.id} txnId={st.txn_id} label="Undo this redemption" onDone={setUndone} /></div> : null}
          <div className="actions"><button className="btn" onClick={restart}>Next redemption</button></div>
        </div>
      );
    }
    if (status !== "pending") {
      const text = status === "declined" ? `${req.name} declined in their app. No points were used.`
        : status === "expired" ? "The customer did not approve in time. No points were used."
        : status === "cancelled" ? "Cancelled. No points were used."
        : `It did not go through: ${errorText(st?.error ?? "")}`;
      return (
        <div className="stack">
          <div className={`msg ${status === "declined" ? "info" : "err"}`}><strong>Not redeemed</strong>{text}</div>
          <div className="actions"><button className="btn" onClick={() => { setReq(null); setSt(null); }}>Try again</button>
            <button className="btn alt" onClick={restart}>New customer</button></div>
        </div>
      );
    }
    return (
      <div className="stack">
        <div className="waiting">
          <span className="pulse" aria-hidden="true" />
          <h2>Waiting for {req.name} to approve</h2>
          <p className="sub" style={{ margin: 0 }}>Ask them to open the Khushi Points app and tap <b>Approve</b>.</p>
          <div className="big" aria-live="polite">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</div>
        </div>
        <div className="actions" style={{ justifyContent: "center" }}><button className="btn alt" onClick={cancel}>Cancel</button></div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={send} autoComplete="off">
      <div><h2>Redeem points</h2><p className="sub">The customer approves in their app. No OTP. Up to {shop.max_redeem_pct}% of the bill, minimum {shop.min_redeem} points.</p></div>
      <CustomerPicker id="r-who" value={raw} onChange={setRaw} shop={shop} onLookup={onLookup} />
      <div><label htmlFor="r-bill">Today's bill (₹)</label><input id="r-bill" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} /></div>
      {who && info && !info.exists && <div className="msg info">This customer has no points at {shop.name} yet.</div>}
      {who && info?.exists && !info.has_app && <div className="msg info"><strong>Needs the Khushi Points app</strong>
        {info.name} has {info.balance} points. To use them, they install the Khushi Points app and sign in with {info.mobile ? maskMobile(info.mobile) : "their number"}.</div>}
      {info?.exists && info.has_app && (
        <div className="preview">
          <span>{info.name} has <b style={{ fontSize: 16 }}>{info.balance}</b> pts {billAmt ? `· max ${maxPts} on this bill` : ""}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="r-pts" style={{ margin: 0 }}>Use</label>
            <input id="r-pts" inputMode="numeric" style={{ width: 90 }} value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ""))} />
            <span>= {inr((parseInt(points, 10) || 0) * Number(shop.point_value))}</span>
          </span>
        </div>
      )}
      <div className="actions"><button className="btn gold" disabled={busy}>{busy ? "Sending…" : "Send to customer's app"}</button></div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
    </form>
  );
}

/* ------------------------------------------------------------------ balance */

function BalanceCheck({ shop, initial }: { shop: Shop; initial: string }) {
  const [raw, setRaw] = useState(initial);
  const [who, setWho] = useState<Who | null>(null);
  const [b, setB] = useState<Balance | null>(null);
  const onLookup = useCallback((w: Who | null, x: Balance | null) => { setWho(w); setB(x); }, []);

  return (
    <div className="stack">
      <div><h2>Check balance</h2><p className="sub">Scan the customer's app QR or type their number.</p></div>
      <CustomerPicker id="b-who" value={raw} onChange={setRaw} shop={shop} onLookup={onLookup} />
      {who && b && !b.exists && <div className="msg info"><strong>No points yet</strong>This customer has not earned points here. Add a bill to start.</div>}
      {who && b?.exists && <RewardsDue shop={shop} who={who} />}
      {who && b?.exists && (
        <div className="receipt">
          <div className="r"><span>{b.name}</span><span>{b.mobile ? fmtMobile(b.mobile) : "App member"}</span></div>
          <div className="r tot"><span>Balance</span><span>{b.balance} pts = {inr(b.value!)}</span></div>
          {!!b.expiring_30d && <div className="r" style={{ color: "var(--warn)" }}><span>Expiring within 30 days</span><span>{b.expiring_30d} pts</span></div>}
          <div className="r"><span>Khushi Points app</span><span>{b.has_app ? "Yes, can redeem" : "Not yet"}</span></div>
          <div style={{ marginTop: 8, borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
            {b.recent?.map((t, i) => (
              <div className={`r${t.undone ? " undone" : ""}`} key={i}>
                <span>{when(t.created_at)} · {t.kind === "earn" ? (t.bill_no ? `Bill ${t.bill_no}` : "Bill") : "Redeemed"}{t.undone ? " (undone)" : ""}</span>
                <span>{t.kind === "earn" ? "+" : "−"}{t.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
