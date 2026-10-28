import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { cleanMobile, errorText, fmtMobile, inr, maskMobile, rpc, supabase, validMobile, when, type Shop } from "../lib";
import { useShop } from "../shop";

type Mode = "earn" | "redeem" | "balance";

type Balance = {
  exists: boolean; name?: string; mobile?: string; balance?: number; value?: number; expiring_30d?: number;
  has_pin?: boolean; pin_locked?: boolean;
  recent?: { kind: string; bill_no: string | null; amount: number; points: number; method: string | null; created_at: string }[];
};

export default function Counter() {
  const { current } = useShop();
  const [params, setParams] = useSearchParams();
  const initialMobile = params.get("balance") ?? "";
  const [mode, setMode] = useState<Mode>(initialMobile ? "balance" : "earn");
  const shop = current!.shop;

  useEffect(() => { if (initialMobile) setParams({}, { replace: true }); }, [initialMobile, setParams]);

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
        {mode === "balance" && <BalanceCheck shop={shop} initial={initialMobile} />}
      </div>
    </div>
  );
}

const pointsFor = (shop: Shop, amount: number) =>
  amount >= Number(shop.min_bill) ? Math.floor((amount * Number(shop.earn_pct)) / 100 / Number(shop.point_value)) : 0;

/* ------------------------------------------------------------------ earn */

function Earn({ shop }: { shop: Shop }) {
  const [mobile, setMobile] = useState("");
  const [billNo, setBillNo] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [isNew, setIsNew] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; title: string; body?: string } | null>(null);

  const m = cleanMobile(mobile);
  const amt = parseFloat(amount) || 0;
  const pts = pointsFor(shop, amt);

  // look up the number once it is complete, to know if it is a new customer
  useEffect(() => {
    setIsNew(null);
    if (!validMobile(m)) return;
    let stale = false;
    rpc<Balance>("customer_balance", { p_shop: shop.id, p_mobile: m })
      .then((b) => { if (!stale) setIsNew(!b.exists); })
      .catch(() => {});
    return () => { stale = true; };
  }, [m, shop.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      const r = await rpc<{ points: number; bill_points: number; topped_up: boolean; earlier_today: number; earlier_bill: number;
        balance: number; value: number; name: string; is_new: boolean }>("add_bill", {
        p_shop: shop.id, p_mobile: m, p_bill_no: billNo, p_amount: amt, p_name: name || null, p_consent: consent,
      });
      setResult(r.topped_up
        ? { kind: "ok", title: `${r.points} points added · bigger bill today`,
            body: `This ${inr(amt)} bill earns ${r.bill_points} points. ${r.earlier_today} were already given today for the ${inr(r.earlier_bill)} bill, so ${r.points} more were added. ${r.name} now has ${r.balance} points, worth ${inr(r.value)}.` }
        : { kind: "ok", title: `${r.points} points added${r.is_new ? " · new customer" : ""}`,
            body: `${r.name} (${maskMobile(m)}) now has ${r.balance} points, worth ${inr(r.value)}.` });
      setMobile(""); setBillNo(""); setAmount(""); setName(""); setConsent(false);
    } catch (err) {
      setResult({ kind: "err", title: "Points not added", body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} autoComplete="off">
      <div><h2>Add bill, give points</h2><p className="sub">No OTP needed. Just the mobile number and the bill.</p></div>
      <div className="row">
        <div><label htmlFor="e-mobile">Customer mobile</label>
          <input id="e-mobile" className="mono" inputMode="numeric" maxLength={14} required value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98480 12345" /></div>
        {isNew && <div><label htmlFor="e-name">Name (new customer)</label><input id="e-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" /></div>}
      </div>
      {isNew && (
        <label className="check" htmlFor="e-consent">
          <input id="e-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Customer agrees that {shop.name} keeps their mobile number to give loyalty points and send OTPs.</span>
        </label>
      )}
      <div className="row">
        <div><label htmlFor="e-bill">Bill number</label><input id="e-bill" className="mono" required value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="B-1043" /></div>
        <div><label htmlFor="e-amt">Bill amount (₹)</label><input id="e-amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1250" /></div>
      </div>
      <div className="preview">
        <span>{amt && amt < Number(shop.min_bill) ? `Bills under ${inr(shop.min_bill)} earn no points` : `Points for this bill (${Number(shop.earn_pct)}% back)`}</span>
        <b>{pts} pts</b>
      </div>
      <div className="actions"><button className="btn" disabled={busy || (isNew === true && !consent)}>{busy ? "Adding…" : "Add points"}</button></div>
      {result && <div className={`msg ${result.kind}`} role="status"><strong>{result.title}</strong>{result.body}</div>}
    </form>
  );
}

/* ------------------------------------------------------------------ redeem */

type RedeemDone = { points: number; discount: number; pay: number; balance: number; method: string; pin_set?: boolean };
type Step =
  | { s: "find" }
  | { s: "verify"; mobile: string; bill: number; points: number; info: Balance; useOtp: boolean; otpSent: boolean; demoCode?: string }
  | { s: "done"; mobile: string; bill: number; name: string; r: RedeemDone };

function Redeem({ shop }: { shop: Shop }) {
  const [step, setStep] = useState<Step>({ s: "find" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // find step
  const [mobile, setMobile] = useState("");
  const [bill, setBill] = useState("");
  const [info, setInfo] = useState<Balance | null>(null);
  const [points, setPoints] = useState("");
  // verify step
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");

  const m = cleanMobile(mobile);
  const billAmt = parseFloat(bill) || 0;
  const cap = Math.floor((billAmt * shop.max_redeem_pct) / 100 / Number(shop.point_value));
  const maxPts = Math.min(info?.balance ?? 0, cap);

  useEffect(() => {
    setInfo(null);
    if (!validMobile(m)) return;
    let stale = false;
    rpc<Balance>("customer_balance", { p_shop: shop.id, p_mobile: m }).then((b) => { if (!stale) setInfo(b); }).catch(() => {});
    return () => { stale = true; };
  }, [m, shop.id]);

  useEffect(() => { if (billAmt && info?.exists) setPoints(String(maxPts)); }, [billAmt, info, maxPts]);

  const order = ["find", "verify", "done"];
  const stepBar = (
    <div className="steps">
      {["1 · Points", "2 · Verify", "3 · Discount"].map((t, k) => {
        const i = order.indexOf(step.s);
        return <span key={t} className={k === i ? "on" : k < i ? "done" : ""}>{t}</span>;
      })}
    </div>
  );

  function toVerify(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const p = parseInt(points, 10) || 0;
    if (!validMobile(m)) return setMsg({ kind: "err", text: errorText("BAD_MOBILE") });
    if (!info?.exists) return setMsg({ kind: "err", text: errorText("NO_CUSTOMER") });
    if (!(billAmt > 0)) return setMsg({ kind: "err", text: "Enter today's bill amount." });
    if ((info.balance ?? 0) < shop.min_redeem) return setMsg({ kind: "err", text: `Needs ${shop.min_redeem} points to redeem. Has ${info.balance}.` });
    if (p < shop.min_redeem) return setMsg({ kind: "err", text: `Minimum ${shop.min_redeem} points per redemption.` });
    if (p > maxPts) return setMsg({ kind: "err", text: `At most ${maxPts} points can be used on this bill.` });
    setPin(""); setOtp(""); setNewPin(""); setNewPin2("");
    setStep({ s: "verify", mobile: m, bill: billAmt, points: p, info, useOtp: !info.has_pin || !!info.pin_locked, otpSent: false });
  }

  async function sendOtp() {
    if (step.s !== "verify") return;
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-otp", { body: { shop_id: shop.id, mobile: step.mobile } });
      if (error) throw error;
      if (data?.error) throw new Error(errorText(data.error));
      setStep({ ...step, useOtp: true, otpSent: true, demoCode: data?.demo_code });
      setMsg({ kind: "info", text: `OTP sent to ${maskMobile(step.mobile)}. Ask the customer for the code.` });
    } catch (err) {
      setMsg({ kind: "err", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function verifyPin(e: FormEvent) {
    e.preventDefault();
    if (step.s !== "verify") return;
    setBusy(true); setMsg(null);
    try {
      const r = await rpc<RedeemDone & { ok: boolean; error?: string; tries_left?: number }>("redeem_with_pin", {
        p_shop: shop.id, p_mobile: step.mobile, p_bill_amount: step.bill, p_points: step.points, p_pin: pin,
      });
      if (!r.ok) {
        setPin("");
        if (r.error === "PIN_LOCKED") { setStep({ ...step, useOtp: true }); setMsg({ kind: "err", text: errorText("PIN_LOCKED") }); }
        else setMsg({ kind: "err", text: `Wrong PIN. ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left.` });
        return;
      }
      setStep({ s: "done", mobile: step.mobile, bill: step.bill, name: step.info.name ?? "", r });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (step.s !== "verify") return;
    if (newPin || newPin2) {
      if (!/^\d{4}$/.test(newPin)) return setMsg({ kind: "err", text: errorText("PIN_FORMAT") });
      if (newPin !== newPin2) return setMsg({ kind: "err", text: "The two PINs do not match." });
    }
    setBusy(true); setMsg(null);
    try {
      const r = await rpc<RedeemDone & { ok: boolean; error?: string; tries_left?: number }>("redeem_with_otp", {
        p_shop: shop.id, p_mobile: step.mobile, p_bill_amount: step.bill, p_points: step.points, p_otp: otp.trim(), p_new_pin: newPin || null,
      });
      if (!r.ok) {
        setOtp("");
        if (r.error === "WRONG_OTP") setMsg({ kind: "err", text: `Wrong OTP. ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left.` });
        else { setStep({ ...step, otpSent: false, demoCode: undefined }); setMsg({ kind: "err", text: errorText(r.error) }); }
        return;
      }
      setStep({ s: "done", mobile: step.mobile, bill: step.bill, name: step.info.name ?? "", r });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep({ s: "find" }); setMobile(""); setBill(""); setPoints(""); setMsg(null);
  }

  const msgEl = msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>;

  if (step.s === "find") {
    return (
      <form className="stack" onSubmit={toVerify} autoComplete="off">
        {stepBar}
        <div><h2>Redeem points</h2><p className="sub">Up to {shop.max_redeem_pct}% of the bill. Minimum {shop.min_redeem} points.</p></div>
        <div className="row">
          <div><label htmlFor="r-mobile">Customer mobile</label><input id="r-mobile" className="mono" inputMode="numeric" maxLength={14} value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
          <div><label htmlFor="r-bill">Today's bill (₹)</label><input id="r-bill" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} /></div>
        </div>
        {info && !info.exists && <div className="msg info">This number has no points yet.</div>}
        {info?.exists && (
          <div className="preview">
            <span>{info.name} has <b style={{ fontSize: 16 }}>{info.balance}</b> pts {billAmt ? `· max ${maxPts} on this bill` : ""}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="r-pts" style={{ margin: 0 }}>Use</label>
              <input id="r-pts" inputMode="numeric" style={{ width: 90 }} value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ""))} />
              <span>= {inr((parseInt(points, 10) || 0) * Number(shop.point_value))}</span>
            </span>
          </div>
        )}
        <div className="actions"><button className="btn">Continue to verify</button></div>
        {msgEl}
      </form>
    );
  }

  if (step.s === "verify") {
    const usePin = !step.useOtp;
    return (
      <div className="stack">
        {stepBar}
        <div><h2>Verify {step.info.name}</h2>
          <p className="sub">Redeeming <b>{step.points} points</b> ({inr(step.points * Number(shop.point_value))}) for {maskMobile(step.mobile)}.</p></div>
        {usePin ? (
          <form className="stack" onSubmit={verifyPin} autoComplete="off">
            <div><label htmlFor="r-pin">Customer types their 4-digit PIN</label>
              <input id="r-pin" className="code" type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
            <div className="actions">
              <button className="btn" disabled={busy || pin.length !== 4}>Verify PIN</button>
              <button type="button" className="btn link" onClick={() => { setStep({ ...step, useOtp: true }); setMsg(null); }}>Forgot PIN? Use OTP</button>
            </div>
            <p className="hint">No SMS is sent, so this check is free.</p>
          </form>
        ) : !step.otpSent ? (
          <>
            <div className="msg info"><strong>{step.info.has_pin ? "Verify with an OTP" : "First redemption: one SMS OTP"}</strong>
              We send a 6-digit code to {maskMobile(step.mobile)}. {step.info.has_pin ? "The customer can set a new PIN after." : "Then the customer sets a PIN, so next time needs no SMS."}</div>
            <div className="actions"><button className="btn gold" onClick={sendOtp} disabled={busy}>{busy ? "Sending…" : "Send OTP by SMS"}</button></div>
          </>
        ) : (
          <form className="stack" onSubmit={verifyOtp} autoComplete="off">
            {step.demoCode && <div className="msg info"><strong>Demo mode: no real SMS sent</strong>The code is <span className="demo-otp">{step.demoCode}</span></div>}
            <div><label htmlFor="r-otp">OTP the customer received</label>
              <input id="r-otp" className="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} /></div>
            <div className="row">
              <div><label htmlFor="r-np1">New PIN for next time</label><input id="r-np1" className="code" type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} /></div>
              <div><label htmlFor="r-np2">Repeat PIN</label><input id="r-np2" className="code" type="password" inputMode="numeric" maxLength={4} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ""))} /></div>
            </div>
            <p className="hint">The customer types the PIN themselves. Leave it empty to skip.{step.info.has_pin ? " Leaving it empty keeps the old PIN." : ""}</p>
            <div className="actions">
              <button className="btn" disabled={busy || otp.length !== 6}>Verify and redeem</button>
              <button type="button" className="btn link" onClick={sendOtp} disabled={busy}>Resend OTP</button>
            </div>
          </form>
        )}
        {msgEl}
        <div className="actions"><button className="btn alt" onClick={restart}>Cancel</button></div>
      </div>
    );
  }

  const { r } = step;
  return (
    <div className="stack">
      {stepBar}
      <div className="msg ok"><strong>Redeemed {r.points} points</strong>
        Verified by {r.method === "pin" ? "PIN (no SMS cost)" : "SMS OTP"}{r.pin_set ? " · PIN saved for next time" : ""}.</div>
      <div className="receipt">
        <div className="r"><span>{step.name}</span><span>{maskMobile(step.mobile)}</span></div>
        <div className="r"><span>Bill amount</span><span>{inr(step.bill)}</span></div>
        <div className="r"><span>Points discount ({r.points} pts)</span><span>− {inr(r.discount)}</span></div>
        <div className="r tot"><span>Customer pays</span><span>{inr(r.pay)}</span></div>
        <div className="r"><span>Points left</span><span>{r.balance} pts</span></div>
      </div>
      <div className="actions"><button className="btn" onClick={restart}>Next redemption</button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ balance */

function BalanceCheck({ shop, initial }: { shop: Shop; initial: string }) {
  const [mobile, setMobile] = useState(initial);
  const [b, setB] = useState<Balance | null>(null);
  const [err, setErr] = useState("");

  async function look(m: string) {
    setErr(""); setB(null);
    const c = cleanMobile(m);
    if (!validMobile(c)) return setErr(errorText("BAD_MOBILE"));
    try { setB(await rpc<Balance>("customer_balance", { p_shop: shop.id, p_mobile: c })); }
    catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { if (initial) look(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); look(mobile); }} autoComplete="off">
      <div><h2>Check balance</h2><p className="sub">No OTP needed to look.</p></div>
      <div><label htmlFor="b-mobile">Customer mobile</label><input id="b-mobile" className="mono" inputMode="numeric" maxLength={14} value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
      <div className="actions"><button className="btn">Show balance</button></div>
      {err && <div className="msg err">{err}</div>}
      {b && !b.exists && <div className="msg info"><strong>No points yet</strong>This number has not earned points here. Add a bill to start.</div>}
      {b?.exists && (
        <div className="receipt">
          <div className="r"><span>{b.name}</span><span>{fmtMobile(b.mobile!)}</span></div>
          <div className="r tot"><span>Balance</span><span>{b.balance} pts = {inr(b.value!)}</span></div>
          {!!b.expiring_30d && <div className="r" style={{ color: "var(--warn)" }}><span>Expiring within 30 days</span><span>{b.expiring_30d} pts</span></div>}
          <div className="r"><span>Redeem with</span><span>{b.has_pin ? (b.pin_locked ? "PIN locked → OTP" : "PIN (no SMS)") : "SMS OTP (first time)"}</span></div>
          <div style={{ marginTop: 8, borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
            {b.recent?.map((t, i) => (
              <div className="r" key={i}><span>{when(t.created_at)} · {t.kind === "earn" ? `Bill ${t.bill_no}` : "Redeemed"}</span><span>{t.kind === "earn" ? "+" : "−"}{t.points}</span></div>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
