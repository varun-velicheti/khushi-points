import { useState } from "react";
import { rpc } from "./lib";

// Two-tap undo: first tap asks, second tap undoes.
export default function UndoButton({ shopId, txnId, label = "Undo", onDone }: {
  shopId: string; txnId: number; label?: string; onDone: (msg: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function click() {
    if (!armed) { setArmed(true); setErr(""); return; }
    setBusy(true);
    try {
      const r = await rpc<{ kind: string; points: number; balance: number }>("reverse_transaction", { p_shop: shopId, p_txn: txnId });
      onDone(r.kind === "earn"
        ? `${r.points} points taken back. Balance now ${r.balance}.`
        : `${r.points} points given back. Balance now ${r.balance}.`);
    } catch (e) {
      setErr((e as Error).message); setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="undo">
      <button type="button" className={`btn small ${armed ? "danger" : "alt"}`} onClick={click} disabled={busy}>
        {busy ? "Undoing…" : armed ? "Tap again to undo" : label}
      </button>
      {armed && !busy && <button type="button" className="btn link small" onClick={() => setArmed(false)}>Keep</button>}
      {err && <span className="undo-err">{err}</span>}
    </span>
  );
}
