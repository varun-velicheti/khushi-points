import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { errorText, supabase } from "../lib";

type Mode = "signin" | "signup" | "forgot";

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const go = (m: Mode) => { setMode(m); setMsg(null); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setMsg({ kind: "ok", text: "Account created. Open the link we emailed you, then sign in." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMsg({ kind: "ok", text: "If that email has an account, we sent a link to set a new password. Check your inbox and spam folder." });
      }
    } catch (err) {
      const t = errorText(err);
      setMsg({ kind: "err", text: /Invalid login/i.test(t) ? "Wrong email or password." : /rate limit/i.test(t) ? "Too many emails sent. Wait a few minutes and try again." : t });
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password";
  const sub = mode === "signin" ? "For shop owners and cashiers."
    : mode === "signup" ? "Owners create the shop. Cashiers join with the shop code."
    : "We will email you a link to set a new password.";

  return (
    <div className="wrap narrow">
      <Link to="/" className="brand" style={{ marginTop: 24, textDecoration: "none", color: "inherit" }}>
        <div className="logo" aria-hidden="true">K</div>
        <div><h1>Khushi Points</h1><div className="shop">Loyalty points for your shop. No WhatsApp needed.</div></div>
      </Link>
      <form className="panel stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <div><h2>{title}</h2><p className="sub">{sub}</p></div>
        <div><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {mode !== "forgot" && (
          <div><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
        {mode === "signup" && <p className="hint">By creating an account you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.</p>}
        {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
        <div className="actions">
          {mode === "signin" && <>
            <button type="button" className="btn link" onClick={() => go("signup")}>New here? Create an account</button>
            <span className="spacer" />
            <button type="button" className="btn link" onClick={() => go("forgot")}>Forgot password?</button>
          </>}
          {mode !== "signin" && <button type="button" className="btn link" onClick={() => go("signin")}>Back to sign in</button>}
        </div>
      </form>
    </div>
  );
}
