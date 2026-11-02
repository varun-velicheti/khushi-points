import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "../lib/auth";
import { registerForPush } from "../lib/push";
import { useColors } from "../lib/theme";
import ApprovalSheet from "../components/ApprovalSheet";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const c = useColors();
  const { session, ready, bump } = useAuth();
  const segments = useSegments();

  // signed out -> sign-in screen; signed in -> wallet
  useEffect(() => {
    if (!ready) return;
    const onSignIn = segments[0] === "sign-in";
    if (!session && !onSignIn) router.replace("/sign-in");
    else if (session && onSignIn) router.replace("/");
  }, [session, ready, segments]);

  useEffect(() => { if (session) registerForPush(); }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // new points arrive: refresh the wallet; tapping an offer, points or expiry notification opens that shop
  useEffect(() => {
    if (Platform.OS === "web") return;
    const got = Notifications.addNotificationReceivedListener((n) => {
      const t = (n.request.content.data as { type?: string })?.type;
      if (t === "earn" || t === "expiry" || t === "offer") bump();
    });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as { type?: string; shop_id?: string };
      if (d?.shop_id && (d.type === "offer" || d.type === "earn" || d.type === "expiry")) { bump(); router.push(`/shop/${d.shop_id}`); }
    });
    return () => { got.remove(); tap.remove(); };
  }, [bump]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
      {session ? <ApprovalSheet /> : null}
    </>
  );
}
