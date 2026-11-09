import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../lib";
import { useShop } from "../shop";
import { kitchenTickets, setTicketStatus, type Ticket } from "./api";

const COLUMNS: { status: Ticket["status"]; label: string; next: Ticket["status"]; back?: Ticket["status"] }[] = [
  { status: "new", label: "New", next: "cooking" },
  { status: "cooking", label: "Cooking", next: "ready", back: "new" },
  { status: "ready", label: "Ready", next: "done", back: "cooking" },
];
const ago = (t: string) => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));

// A short two-note chime for a new ticket.
function chime() {
  try {
    const a = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = f; o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.0001, a.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.3, a.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + i * 0.18 + 0.3);
      o.start(a.currentTime + i * 0.18); o.stop(a.currentTime + i * 0.18 + 0.32);
    });
  } catch { /* no sound on this device */ }
}

// Kitchen screen: tap a ticket to move it along. New tickets chime.
export default function Kitchen() {
  const { current } = useShop();
  const shopId = current!.shop.id;
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState("");
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await kitchenTickets(shopId);
      if (seen.current && t.some((x) => x.status === "new" && !seen.current!.has(x.id))) chime();
      seen.current = new Set(t.map((x) => x.id));
      setTickets(t); setErr("");
    } catch (e) { setErr(errorText(e)); }
  }, [shopId]);
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i); }, [load]);

  async function move(t: Ticket, status: Ticket["status"]) {
    setTickets((all) => all?.map((x) => (x.id === t.id ? { ...x, status } : x)).filter((x) => x.status !== "done") ?? null);
    await setTicketStatus(shopId, t.id, status).catch((e) => setErr(errorText(e)));
    load();
  }

  return (
    <div className="kitchen">
      {err && <div className="msg err">{err}</div>}
      {COLUMNS.map((c) => {
        const list = (tickets ?? []).filter((t) => t.status === c.status);
        return (
          <section key={c.status} className={`k-col k-${c.status}`}>
            <h2>{c.label}<span>{list.length}</span></h2>
            {list.map((t) => (
              <article key={t.id} className={`ticket${t.cancelled ? " cancelled" : ""}`}>
                <button className="ticket-body" onClick={() => move(t, c.next)}>
                  <header><b>#{t.no}</b><span>{t.table ?? "Takeaway"}</span><time className={ago(t.created_at) >= 15 ? "late" : ""}>{ago(t.created_at)} min</time></header>
                  {t.cancelled && <div className="ticket-cancel">Order cancelled</div>}
                  <ul>
                    {t.lines.map((l, i) => (
                      <li key={i} className={l.qty < 0 ? "minus" : ""}>
                        <b>{l.qty < 0 ? `Cancel ${-l.qty}` : l.qty}</b> × {l.name}
                        {l.note && <small>{l.note}</small>}
                      </li>
                    ))}
                  </ul>
                </button>
                {c.back && <button className="ticket-back" aria-label="Move back" onClick={() => move(t, c.back!)}>‹</button>}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
