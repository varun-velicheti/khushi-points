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
};

const ShopContext = createContext<Ctx | null>(null);
const LAST = "kp-last-shop";

export function ShopProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(startedInRecovery);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST); } catch { return null; }
  });

  const reload = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    if (!session) { setMemberships([]); setLoading(false); return; }
    const { data } = await supabase
      .from("shop_members")
      .select("role, shop:shops(*)")
      .eq("user_id", session.user.id);
    setMemberships((data ?? []) as unknown as Membership[]);
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
    <ShopContext.Provider value={{ session, loading, memberships, current, selectShop, reload, updateShop, recovery, endRecovery: () => setRecovery(false) }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  const c = useContext(ShopContext);
  if (!c) throw new Error("useShop outside ShopProvider");
  return c;
}
