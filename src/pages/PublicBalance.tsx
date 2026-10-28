import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { cleanMobile, errorText, inr, rpc, validMobile } from "../lib";

// Page customers open from the QR code on the counter. No login.
export default function PublicBalance() {
  const { slug = "" } = useParams();
  const [shop, setShop] = useState<{ shop: string; earn_pct: number; point_value: number; min_redeem: number } | null | undefined>(undefined);
  const [mobile, setMobile] = useState("");
  const [res, setRes] = useState<{ points: number; value: number } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    rpc<typeof shop>("public_shop", { p_slug: slug }).then(setShop).catch(() => setShop(null));
  }, [slug]);

  async function check(e: FormEvent) {
    e.preventDefault(); setErr(""); setRes(null);
    const m = cleanMobile(mobile);
    if (!validMobile(m)) return setErr(errorText("BAD_MOBILE"));
    try { setRes(await rpc("public_balance", { p_slug: slug, p_mobile: m })); }
    catch (e2) { setErr((e2 as Error).message); }
  }

  if (shop === undefined) return <div className="wrap narrow hint">Loading…</div>;
  if (shop === null) return <div className="wrap narrow"><div className="panel" style={{ marginTop: 40 }}><h2>Shop not found</h2><p className="sub">Check the link or scan the QR code at the shop again.</p></div></div>;

  return (
    <div className="wrap narrow">
      <div className="brand" style={{ marginTop: 24 }}>
        <div className="logo" aria-hidden="true">K</div>
        <div><h1>{shop.shop}</h1><div className="shop">Loyalty points · Khushi Points</div></div>
      </div>
      <form className="panel stack" style={{ marginTop: 20 }} onSubmit={check} autoComplete="off">
        <div><h2>Check your points</h2>
          <p className="sub">You earn {Number(shop.earn_pct)}% of every bill as points. 1 point = {inr(shop.point_value)}. Redeem from {shop.min_redeem} points.</p></div>
        <div><label htmlFor="p-mobile">Your mobile number</label><input id="p-mobile" className="mono" inputMode="numeric" maxLength={14} value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
        <button className="btn">Show my points</button>
        {err && <div className="msg err">{err}</div>}
        {res && (
          <div className="center stack" style={{ gap: 4 }}>
            <div className="big">{res.points}</div>
            <div className="hint">points · worth {inr(res.value)}</div>
            {res.points >= shop.min_redeem
              ? <div className="msg ok" style={{ marginTop: 10 }}>You can redeem at the counter. Keep your phone with you for the OTP or PIN.</div>
              : <div className="msg info" style={{ marginTop: 10 }}>{shop.min_redeem - res.points} more points to start redeeming.</div>}
          </div>
        )}
      </form>
    </div>
  );
}
