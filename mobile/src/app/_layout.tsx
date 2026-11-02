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
  const { session, ready } = useAuth();
  const segments = useSegments();

  // signed out -> sign-in screen; signed in -> wallet
  useEffect(() => {
    if (!ready) return;
    const onSignIn = segments[0] === "sign-in";
    if (!session && !onSignIn) router.replace("/sign-in");
    else if (session && onSignIn) router.replace("/");
  }, [session, ready, segments]);

  useEffect(() => { if (session) registerForPush(); }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // tapping an offer notification opens that shop
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as { type?: string; shop_id?: string };
      if (d?.type === "offer" && d.shop_id) router.push(`/shop/${d.shop_id}`);
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
      {session ? <ApprovalSheet /> : null}
    </>
  );
}
