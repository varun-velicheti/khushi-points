import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { category, useColors } from "../lib/theme";

export function Screen({ children, refreshing, onRefresh, title, subtitle, right }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; title?: string; subtitle?: string; right?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32, paddingHorizontal: 16, gap: 14 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} /> : undefined}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.h1, { color: c.ink }]} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string;
}) {
  const c = useColors();
  const base = [s.card, { backgroundColor: c.surface, borderColor: c.line }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>{children}</Pressable>
  );
}

export function Btn({ title, onPress, kind = "primary", busy, disabled, icon, style }: {
  title: string; onPress: () => void; kind?: "primary" | "gold" | "alt" | "danger" | "link"; busy?: boolean; disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = { primary: c.brand, gold: c.accent, alt: c.sunk, danger: c.badBg, link: "transparent" }[kind];
  const fg = { primary: c.brandInk, gold: c.accentInk, alt: c.ink, danger: c.bad, link: c.brand }[kind];
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, kind === "link" && { paddingHorizontal: 0 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <>
        {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
        <Text style={{ color: fg, fontWeight: "700", fontSize: 16 }}>{title}</Text>
      </>}
    </Pressable>
  );
}

export function ShopAvatar({ cat, size = 44 }: { cat?: string | null; size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 3.2, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={category(cat).icon as keyof typeof Ionicons.glyphMap} size={size * 0.5} color={c.brandInk} />
    </View>
  );
}

export function Note({ kind = "info", title, children }: { kind?: "info" | "ok" | "err"; title?: string; children?: ReactNode }) {
  const c = useColors();
  const bg = { info: c.warnBg, ok: c.goodBg, err: c.badBg }[kind];
  const fg = { info: c.warn, ok: c.good, err: c.bad }[kind];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, gap: 2 }} accessibilityRole="alert">
      {title ? <Text style={{ color: fg, fontWeight: "700", fontSize: 15 }}>{title}</Text> : null}
      {typeof children === "string" ? <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text> : children}
    </View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[{ color: c.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }, style]}>{children}</Text>;
}

export function Loading() {
  const c = useColors();
  return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={c.brand} /></View>;
}

export const s = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.3 },
  h2: { fontSize: 19, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
