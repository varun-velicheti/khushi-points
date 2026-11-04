import { useColorScheme } from "react-native";

// Khushi Points look: warm coral gradient, white rounded cards, soft-pink icon circles.
const light = {
  bg: "#F7F3F4", surface: "#FFFFFF", sunk: "#F4ECEE", ink: "#1F1416", muted: "#7B6B6F", line: "#EFE4E6",
  brand: "#F0475A", brandDeep: "#E3354D", brandSoft: "#FFE9EC", brandInk: "#FFFFFF",
  gradTop: "#FF6B6B", gradBottom: "#E9354F",
  accent: "#F5A524", accentInk: "#3A2600",
  good: "#16A35A", goodBg: "#E3F6EA", bad: "#D93848", badBg: "#FDE8EA", warn: "#B26A00", warnBg: "#FFF3DC",
  shadow: "rgba(176, 52, 72, 0.10)",
};
const dark: typeof light = {
  bg: "#141012", surface: "#1F181A", sunk: "#2A2124", ink: "#F6EDEF", muted: "#B6A4A8", line: "#3A2E31",
  brand: "#FF6B7A", brandDeep: "#F0475A", brandSoft: "#3B1E25", brandInk: "#FFFFFF",
  gradTop: "#E8505E", gradBottom: "#B92741",
  accent: "#F7B648", accentInk: "#3A2600",
  good: "#5FD38F", goodBg: "#163322", bad: "#FF8A8F", badBg: "#3D1A1E", warn: "#F7B648", warnBg: "#35290C",
  shadow: "rgba(0, 0, 0, 0.35)",
};
export type Colors = typeof light;
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

// Plus Jakarta Sans, loaded in the root layout.
export const F = {
  regular: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  heavy: "PlusJakartaSans_800ExtraBold",
};

const CAT: Record<string, { label: string; icon: string }> = {
  restaurant: { label: "Restaurant", icon: "restaurant" }, cafe: { label: "Café", icon: "cafe" },
  bakery: { label: "Bakery", icon: "pizza" }, sweets: { label: "Sweets", icon: "gift" },
  icecream: { label: "Ice cream", icon: "ice-cream" }, grocery: { label: "Grocery", icon: "basket" },
  supermarket: { label: "Supermarket", icon: "cart" }, clothing: { label: "Clothing", icon: "shirt" },
  salon: { label: "Salon", icon: "cut" }, pharmacy: { label: "Pharmacy", icon: "medkit" },
  electronics: { label: "Electronics", icon: "phone-portrait" }, other: { label: "Shop", icon: "storefront" },
};
export const category = (c?: string | null) => CAT[c ?? "other"] ?? CAT.other;
