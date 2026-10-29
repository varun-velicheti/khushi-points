import { useState, type FormEvent } from "react";
import { errorText, supabase } from "../lib";
import { useShop } from "../shop";

// Shown after the user opens the "reset password" email link.
export default function ResetPassword() {
  const { endRecovery, session } = useShop();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (pw.length < 8) return setMsg({ kind: "err", text: "Use a password of at least 8 characters." });
    if (pw !== pw2) return setMsg({ kind: "err", text: "The two passwords do not match." });
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setDone(true);
      window.history.replaceState(null, "", "/");
    } catch (err) {
      setMsg({ kind: "err", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap narrow">
      <div className="brand" style={{ marginTop: 24 }}>
        <div className="logo" aria-hidden="true">K</div>
        <div><h1>Khushi Points</h1><div className="shop">{session?.user.email}</div></div>
      </div>
      {done ? (
        <div className="panel stack" style={{ marginTop: 20 }}>
          <div className="msg ok"><strong>Password changed</strong>Use the new password next time you sign in.</div>
          <button className="btn" onClick={endRecovery}>Continue to my shop</button>
        </div>
      ) : (
        <form className="panel stack" style={{ marginTop: 20 }} onSubmit={save}>
          <div><h2>Set a new password</h2><p className="sub">At least 8 characters.</p></div>
          <div><label htmlFor="np">New password</label><input id="np" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label htmlFor="np2">Repeat new password</label><input id="np2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
          {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
        </form>
      )}
    </div>
  );
}
