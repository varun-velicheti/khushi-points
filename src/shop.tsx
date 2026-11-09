import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { startedInRecovery, supabase, type Membership, type Shop } from "./lib";

type Ctx = {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  current: Membership | null;
  selectShop: (id: string) => void;
  reload: () => Promise<void>;
  updateShop: (s: Shop) => void;
  recovery: boolean;
  endRecovery: () => void;
  isAdmin: boolean;
};

const ShopContext = createContext<Ctx | null>(null);

function readJson<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
// The sign-in Supabase keeps on this device (used only when offline).
function savedSession(): Session | null {
  try {
    const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
    return k ? (readJson<Session>(k)) : null;
  } catch { return null; }
}
const LAST = "kp-last-shop";

export function ShopProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(startedInRecovery);
  const [isAdmin, setIsAdmin] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST); } catch { return null; }
  });

  const reload = useCallback(async () => {
    let { data: { session } } = await supabase.auth.getSession();
    // offline with an expired sign-in: keep working with the saved one (it refreshes when back online)
    if (!session && !navigator.onLine) session = savedSession();
    setSession(session);
    if (!session) { setMemberships([]); setIsAdmin(false); setLoading(false); return; }
    const { data: admin } = await supabase.rpc("is_platform_admin");
    setIsAdmin(admin === true);
    const { data, error } = await supabase
      .from("shop_members")
      .select("role, shop:shops(*)")
      .eq("user_id", session.user.id);
    // offline: use the shops saved last time
    const saved = `kp-memberships:${session.user.id}`;
    if (error || !data) setMemberships(readJson<Membership[]>(saved) ?? []);
    else { setMemberships(data as unknown as Membership[]); try { localStorage.setItem(saved, JSON.stringify(data)); } catch { /* blocked */ } }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") reload();
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);

  const current = memberships.find((m) => m.shop.id === currentId) ?? memberships[0] ?? null;

  const selectShop = (id: string) => {
    setCurrentId(id);
    try { localStorage.setItem(LAST, id); } catch { /* private mode */ }
  };
  const updateShop = (s: Shop) =>
    setMemberships((ms) => ms.map((m) => (m.shop.id === s.id ? { ...m, shop: s } : m)));

  return (
    <ShopContext.Provider value={{ session, loading, memberships, current, selectShop, reload, updateShop, recovery, endRecovery: () => setRecovery(false), isAdmin }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  const c = useContext(ShopContext);
  if (!c) throw new Error("useShop outside ShopProvider");
  return c;
}
