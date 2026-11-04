import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { F, useColors } from "../../lib/theme";

export default function TabsLayout() {
  const c = useColors();
  const icon = (on: keyof typeof Ionicons.glyphMap, off: keyof typeof Ionicons.glyphMap) =>
    ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) =>
      <Ionicons name={focused ? on : off} size={size} color={color} />;
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: c.brand, tabBarInactiveTintColor: c.muted,
      tabBarLabelStyle: { fontFamily: F.semibold, fontSize: 11.5 },
      tabBarStyle: { backgroundColor: c.surface, borderTopWidth: 0, height: 64, paddingTop: 6,
        shadowColor: c.shadow, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 12 },
      sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home", "home-outline") }} />
      <Tabs.Screen name="qr" options={{ title: "My QR", tabBarIcon: icon("qr-code", "qr-code-outline") }} />
      <Tabs.Screen name="offers" options={{ title: "Offers", tabBarIcon: icon("pricetags", "pricetags-outline") }} />
      <Tabs.Screen name="me" options={{ title: "Profile", tabBarIcon: icon("person", "person-outline") }} />
    </Tabs>
  );
}
