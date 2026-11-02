import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColors } from "../../lib/theme";

export default function TabsLayout() {
  const c = useColors();
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: ColorValue; size: number }) =>
    <Ionicons name={name} size={size} color={color} />;
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: c.brand, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line }, sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: "Wallet", tabBarIcon: icon("wallet") }} />
      <Tabs.Screen name="qr" options={{ title: "My QR", tabBarIcon: icon("qr-code") }} />
      <Tabs.Screen name="offers" options={{ title: "Offers", tabBarIcon: icon("pricetags") }} />
      <Tabs.Screen name="me" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
