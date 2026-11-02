import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { rpc, type Me } from "./api";

type Ctx = {
  session: Session | null; ready: boolean; me: Me | null;
  refreshMe: () => Promise<void>; version: number; bump: () => void;
};
const AuthContext = createContext<Ctx | null>(null);

// Keeps the sign-in fresh while the app is open (Supabase's advice for mobile).
AppState.addEventListener("change", (s) => {
  if (s === "active") supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [version, setVersion] = useState(0);   // bump to make screens reload their data

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const refreshMe = useCallback(async () => {
    try { setMe(await rpc<Me>("app_me")); } catch { /* offline: keep last */ }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) refreshMe(); else setMe(null); }, [session?.user.id, refreshMe]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ session, ready, me, refreshMe, version, bump }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
