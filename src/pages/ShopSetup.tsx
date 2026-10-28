import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { rpc, supabase, type Shop } from "../lib";
import { useShop } from "../shop";

export default function ShopSetup({ embedded = false }: { embedded?: boolean }) {
  const { reload, selectShop, session } = useShop();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(fn: () => Promise<Shop>) {
    setBusy(true); setErr("");
    try {
      const shop = await fn();
      selectShop(shop.id);
      await reload();
      navigate("/");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const create = (e: FormEvent) => { e.preventDefault(); run(() => rpc<Shop>("create_shop", { p_name: name })); };
  const join = (e: FormEvent) => { e.preventDefault(); run(() => rpc<Shop>("join_shop", { p_code: code })); };

  return (
    <div className={embedded ? "page" : "wrap narrow"}>
      {!embedded && (
        <div className="brand" style={{ marginTop: 24 }}>
          <div className="logo" aria-hidden="true">K</div>
          <div><h1>Welcome</h1><div className="shop">{session?.user.email}</div></div>
        </div>
      )}
      <form className="panel stack" style={embedded ? undefined : { marginTop: 20 }} onSubmit={create}>
        <div><h2>I own a shop</h2><p className="sub">Create your shop. You can change the points rules later.</p></div>
        <div><label htmlFor="shopname">Shop name</label><input id="shopname" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sri Lakshmi Stores" /></div>
        <button className="btn" disabled={busy}>Create shop</button>
      </form>
      <form className="panel stack" style={{ marginTop: 16 }} onSubmit={join}>
        <div><h2>I work at a shop</h2><p className="sub">Ask the owner for the 6-letter shop code. It is on their Owner page.</p></div>
        <div><label htmlFor="joincode">Shop code</label><input id="joincode" className="mono" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7PQ2M" /></div>
        <button className="btn alt" disabled={busy}>Join shop</button>
      </form>
      {err && <div className="msg err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
      {!embedded && <div className="actions" style={{ marginTop: 16 }}><button className="btn link" onClick={() => supabase.auth.signOut()}>Sign out</button></div>}
    </div>
  );
}
