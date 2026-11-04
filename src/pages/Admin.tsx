import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { inr, rpc, supabase, when } from "../lib";
import { useShop } from "../shop";

// Founder-only view of every shop. Totals only: no customer numbers or names.

type Overview = {
  shops: number; shops_active_7d: number; staff: number; customers: number; customers_pin: number;
  bills_today: number; bills_30d: number; sales_30d: number; redeems_30d: number; redeems_pin_30d: number;
  undone_30d: number; sms_30d: number; sms_real_30d: number; sms_failed_7d: number; sms_last_error: string | null;
  points_owed_value: number; bills_by_day: number[];
};
type ShopRow = {
  shop_id: string; name: string; plan: string; created_at: string; owner_email: string | null; staff: number;
  customers: number; customers_pin: number; bills_7d: number; bills_30d: number; sales_30d: number;
  redeems_30d: number; redeems_pin_30d: number; sms_30d: number; sms_failed_7d: number;
  last_activity: string | null; bills_by_day: number[];
};

const DAY = 864e5;
function status(last: string | null): { label: string; cls: string } {
  if (!last) return { label: "Not started", cls: "st-none" };
  const age = Date.now() - new Date(last).getTime();
  if (age < DAY) return { label: "Active today", cls: "st-good" };
  if (age < 7 * DAY) return { label: "Active this week", cls: "st-ok" };
  if (age < 14 * DAY) return { label: "Quiet", cls: "st-warn" };
  return { label: "Inactive", cls: "st-bad" };
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");

function dayLabels(): string[] {
  const out: string[] = [];
  for (let i = 13; i >= 0; i--) {
    out.push(new Date(Date.now() - i * DAY).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  }
  return out;
}

// Bars for the last 14 days. One series, so no legend; hover or tap shows the day and count.
function DayBars({ values, height = 120, labels = false }: { values: number[]; height?: number; labels?: boolean }) {
  const days = dayLabels();
  const max = Math.max(1, ...values);
  return (
    <figure className="daybars" aria-label={`Bills per day, last 14 days: ${values.map((v, i) => `${days[i]} ${v}`).join(", ")}`}>
      <div className="db-plot" style={{ height }}>
        {values.map((v, i) => (
          <div className="db-col" key={i} title={`${days[i]}: ${v} bill${v === 1 ? "" : "s"}`} tabIndex={labels ? 0 : -1}>
            {v > 0 && <div className="db-bar" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />}
            {labels && <span className="db-tip">{days[i]} · {v}</span>}
          </div>
        ))}
      </div>
      {labels && <figcaption className="db-axis"><span>{days[0]}</span><span>Peak {max}</span><span>Today</span></figcaption>}
    </figure>
  );
}

export default function Admin() {
  const { memberships, session } = useShop();
  const [o, setO] = useState<Overview | null>(null);
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  async function load() {
    setErr("");
    try {
      const [ov, sh] = await Promise.all([rpc<Overview>("admin_overview", {}), rpc<ShopRow[]>("admin_shops", {})]);
      setO(ov); setShops(sh); setLoadedAt(new Date());
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (shops ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || (r.owner_email ?? "").toLowerCase().includes(s));
  }, [shops, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (shops ?? []).forEach((r) => { const k = status(r.last_activity).label; c[k] = (c[k] ?? 0) + 1; });
    return c;
  }, [shops]);

  return (
    <div className="wrap admin">
      <header className="top">
        <div className="brand">
          <img className="logo" src="/icon.svg" alt="" />
          <div><h1>Khushi Points</h1><div className="shop">Admin · {session?.user.email}</div></div>
        </div>
        <div className="top-actions">
          <button className="btn alt small" onClick={load}>Refresh</button>
          {memberships.length > 0 && <Link className="btn alt small" to="/">My shop</Link>}
          <button className="btn alt small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {err && <div className="msg err" style={{ marginTop: 16 }}>{err}</div>}
      {!o && !err && <p className="hint" style={{ marginTop: 16 }}>Loading…</p>}

      {o && (
        <div className="page">
          <div className="kpis">
            <div className="kpi"><div className="k">Shops</div><div className="v">{o.shops}</div><div className="n">{o.shops_active_7d} active this week</div></div>
            <div className="kpi"><div className="k">Bills today</div><div className="v">{o.bills_today}</div><div className="n">{o.bills_30d} in 30 days</div></div>
            <div className="kpi"><div className="k">Sales with points, 30 days</div><div className="v">{inr(o.sales_30d)}</div><div className="n">across all shops</div></div>
            <div className="kpi"><div className="k">Redemptions, 30 days</div><div className="v">{o.redeems_30d}</div><div className="n">{pct(o.redeems_pin_30d, o.redeems_30d)} used a free PIN</div></div>
            <div className="kpi"><div className="k">Customers</div><div className="v">{o.customers}</div><div className="n">{pct(o.customers_pin, o.customers)} have a PIN</div></div>
            <div className="kpi"><div className="k">SMS, 30 days</div><div className="v">{o.sms_real_30d}</div><div className="n">real SMS sent{o.sms_30d > o.sms_real_30d ? ` · ${o.sms_30d - o.sms_real_30d} demo` : ""}</div></div>
            <div className="kpi"><div className="k">Points owed by shops</div><div className="v">{inr(o.points_owed_value)}</div><div className="n">unused, not expired</div></div>
            <div className="kpi"><div className="k">Undone, 30 days</div><div className="v">{o.undone_30d}</div><div className="n">bills and redemptions reversed</div></div>
          </div>

          {o.sms_failed_7d > 0 && (
            <div className="msg err" role="alert"><strong>{o.sms_failed_7d} SMS failed in the last 7 days</strong>
              Last reply from the provider: <span className="mono">{o.sms_last_error ?? "none recorded"}</span>. Check credits and settings.</div>
          )}

          <div className="panel">
            <h2>Bills per day, all shops</h2>
            <p className="sub">Last 14 days. Tap or hover a bar to see that day.</p>
            <DayBars values={o.bills_by_day} height={140} labels />
          </div>

          <div className="panel">
            <div className="admin-head">
              <div><h2>Shops</h2>
                <p className="sub">{Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "No shops yet"}</p></div>
              <input aria-label="Search shops" placeholder="Search shop or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="shop-cards">
              {filtered.map((r) => {
                const st = status(r.last_activity);
                return (
                  <article className="shop-card" key={r.shop_id}>
                    <div className="sc-top">
                      <div style={{ minWidth: 0 }}>
                        <h3>{r.name}</h3>
                        <div className="hint sc-owner">{r.owner_email ?? "no owner"} · joined {when(r.created_at)}</div>
                      </div>
                      <span className={`status ${st.cls}`}>{st.label}</span>
                    </div>
                    <DayBars values={r.bills_by_day} height={44} />
                    <dl className="sc-stats">
                      <div><dt>Bills 7d</dt><dd>{r.bills_7d}</dd></div>
                      <div><dt>Bills 30d</dt><dd>{r.bills_30d}</dd></div>
                      <div><dt>Sales 30d</dt><dd>{inr(r.sales_30d)}</dd></div>
                      <div><dt>Customers</dt><dd>{r.customers}</dd></div>
                      <div><dt>Redeems 30d</dt><dd>{r.redeems_30d}{r.redeems_30d ? <span className="hint"> · {pct(r.redeems_pin_30d, r.redeems_30d)} PIN</span> : null}</dd></div>
                      <div><dt>SMS 30d</dt><dd>{r.sms_30d}{r.sms_failed_7d ? <span className="sc-fail"> · {r.sms_failed_7d} failed</span> : null}</dd></div>
                      <div><dt>Staff</dt><dd>{r.staff}</dd></div>
                      <div><dt>Plan</dt><dd className="cap">{r.plan}</dd></div>
                    </dl>
                    <div className="hint">Last activity: {r.last_activity ? when(r.last_activity) : "none yet"}</div>
                  </article>
                );
              })}
              {shops && filtered.length === 0 && <p className="hint">No shops match.</p>}
            </div>
          </div>
          {loadedAt && <p className="hint">Updated {loadedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Customer numbers and names are never shown here.</p>}
        </div>
      )}
    </div>
  );
}
