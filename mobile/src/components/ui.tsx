import type { ReactNode } from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextProps, type TextStyle, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { logoUrl } from "../lib/api";
import { category, F, useColors } from "../lib/theme";

export type IconName = keyof typeof Ionicons.glyphMap;

// Text in the app font. w = weight, s = size, c = colour.
export function K({ w = "regular", s = 15, c, style, ...rest }: TextProps & {
  w?: keyof typeof F; s?: number; c?: string; style?: StyleProp<TextStyle>;
}) {
  const col = useColors();
  return <Text {...rest} style={[{ fontFamily: F[w], fontSize: s, color: c ?? col.ink, lineHeight: Math.round(s * 1.35) }, style]} />;
}

export const logoMark = require("../../assets/logo-mark.png");

export function LogoMark({ size = 36 }: { size?: number }) {
  return <Image source={logoMark} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
}

// Coral gradient band at the top of a screen. Content below can overlap it (see Page).
export function GradientHeader({ title, left, right, children, tall = false }: {
  title?: string; left?: ReactNode; right?: ReactNode; children?: ReactNode; tall?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={[c.gradTop, c.gradBottom]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }}
      style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: tall ? 72 : 22,
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
        <View style={{ width: 44, alignItems: "flex-start" }}>{left}</View>
        <View style={{ flex: 1, alignItems: "center" }}>
          {title ? <K w="heavy" s={20} c="#FFFFFF" numberOfLines={1} accessibilityRole="header">{title}</K> : null}
        </View>
        <View style={{ width: 44, alignItems: "flex-end" }}>{right}</View>
      </View>
      {children}
    </LinearGradient>
  );
}

export function HeaderButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={20} color="#FFFFFF" />
    </Pressable>
  );
}

// Scrolling page: header, then content that overlaps the header by `overlap` px.
export function Page({ header, children, refreshing, onRefresh, overlap = 0 }: {
  header?: ReactNode; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; overlap?: number;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} colors={[c.brand]} /> : undefined}>
      {header}
      <View style={{ paddingHorizontal: 16, gap: 16, marginTop: header ? -overlap : insets.top + 16 }}>{children}</View>
    </ScrollView>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string;
}) {
  const c = useColors();
  const base = [s.card, { backgroundColor: c.surface, shadowColor: c.shadow }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.99 }], opacity: 0.92 }]}>{children}</Pressable>
  );
}

export function Btn({ title, onPress, kind = "primary", busy, disabled, icon, style }: {
  title: string; onPress: () => void; kind?: "primary" | "gold" | "alt" | "danger" | "link" | "white"; busy?: boolean;
  disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = { primary: c.brand, gold: c.accent, alt: c.brandSoft, danger: c.badBg, link: "transparent", white: "#FFFFFF" }[kind];
  const fg = { primary: c.brandInk, gold: c.accentInk, alt: c.brand, danger: c.bad, link: c.brand, white: c.brand }[kind];
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === "link" && { paddingHorizontal: 0, minHeight: 36 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <>
        {icon ? <Ionicons name={icon} size={19} color={fg} /> : null}
        <K w="bold" s={16} c={fg}>{title}</K>
      </>}
    </Pressable>
  );
}

// Soft-pink circle with a coral icon and a label under it.
export function IconTile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={26} color={c.brand} />
      </View>
      <K w="semibold" s={13} style={{ textAlign: "center" }}>{label}</K>
    </Pressable>
  );
}

// Shop's own logo when it has one, otherwise an icon for its type of shop.
export function ShopAvatar({ cat, logo, size = 48, onBrand = false }: { cat?: string | null; logo?: string | null; size?: number; onBrand?: boolean }) {
  const c = useColors();
  const uri = logoUrl(logo);
  if (uri) return (
    <Image source={{ uri }} accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: onBrand ? "#FFFFFF" : c.brandSoft }} />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center",
      backgroundColor: onBrand ? "#FFFFFF" : c.brandSoft }}>
      <Ionicons name={category(cat).icon as IconName} size={size * 0.46} color={c.brand} />
    </View>
  );
}

// Small "Regular" badge (star + word), or a star-only dot for tight spots.
export function RegularBadge({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  if (compact) return (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.accent, borderWidth: 2, borderColor: "#FFFFFF",
      alignItems: "center", justifyContent: "center" }} accessibilityLabel="Regular">
      <Ionicons name="star" size={12} color="#FFFFFF" />
    </View>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.warnBg, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Ionicons name="star" size={12} color={c.warn} />
      <K w="bold" s={12} c={c.warn}>Regular</K>
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
      <K w="heavy" s={18} accessibilityRole="header">{title}</K>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <K w="bold" s={14} c={c.brand}>{action}</K><Ionicons name="arrow-forward" size={16} color={c.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Settings-style row: soft icon circle, label, optional detail and right side.
export function ListRow({ icon, label, detail, right, onPress, danger }: {
  icon: IconName; label: string; detail?: string; right?: ReactNode; onPress?: () => void; danger?: boolean;
}) {
  const c = useColors();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: danger ? c.badBg : c.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={danger ? c.bad : c.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <K w="semibold" s={15} c={danger ? c.bad : c.ink}>{label}</K>
        {detail ? <K s={13} c={c.muted}>{detail}</K> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.muted} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{body}</Pressable>;
}

export function Note({ kind = "info", title, children }: { kind?: "info" | "ok" | "err"; title?: string; children?: ReactNode }) {
  const c = useColors();
  const bg = { info: c.warnBg, ok: c.goodBg, err: c.badBg }[kind];
  const fg = { info: c.warn, ok: c.good, err: c.bad }[kind];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, gap: 2 }} accessibilityRole="alert">
      {title ? <K w="bold" s={15} c={fg}>{title}</K> : null}
      {typeof children === "string" ? <K s={14} c={fg}>{children}</K> : children}
    </View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <K w="bold" s={12} c={c.muted} style={[{ letterSpacing: 0.6, textTransform: "uppercase" }, style]}>{children}</K>;
}

export function Loading() {
  const c = useColors();
  return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={c.brand} /></View>;
}

export const s = StyleSheet.create({
  card: { borderRadius: 20, padding: 16, gap: 8, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 16, elevation: 3 },
  btn: { minHeight: 52, borderRadius: 16, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  input: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, minHeight: 54, fontSize: 18, fontFamily: F.semibold },
});
