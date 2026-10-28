import { useState, type FormEvent } from "react";
import { errorText, supabase } from "../lib";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMsg({ kind: "ok", text: "Account created. Open the link we emailed you, then sign in." });
      }
    } catch (err) {
      const t = errorText(err);
      setMsg({ kind: "err", text: /Invalid login/i.test(t) ? "Wrong email or password." : t });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap narrow">
      <div className="brand" style={{ marginTop: 24 }}>
        <div className="logo" aria-hidden="true">K</div>
        <div><h1>Khushi Points</h1><div className="shop">Loyalty points for your shop. No WhatsApp needed.</div></div>
      </div>
      <form className="panel stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <div>
          <h2>{mode === "signin" ? "Sign in" : "Create your account"}</h2>
          <p className="sub">{mode === "signin" ? "For shop owners and cashiers." : "Owners create the shop. Cashiers join with the shop code."}</p>
        </div>
        <div><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
        <button type="button" className="btn link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}>
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
