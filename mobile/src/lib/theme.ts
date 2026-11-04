// Khushi Points look: warm coral gradient, white rounded cards, soft-pink icon circles.
const light = {
  bg: "#F6F7FA", surface: "#FFFFFF", sunk: "#F1F2F6", ink: "#16181D", muted: "#5F6472", line: "#E6E8EE",
  brand: "#F0475A", brandDeep: "#E3354D", brandSoft: "#FFE9EC", brandInk: "#FFFFFF",
  gradTop: "#FF6B6B", gradBottom: "#E9354F",
  accent: "#F5A524", accentInk: "#3A2600",
  good: "#16A35A", goodBg: "#E3F6EA", bad: "#D93848", badBg: "#FDE8EA", warn: "#B26A00", warnBg: "#FFF3DC",
  shadow: "rgba(22, 24, 29, 0.08)",
};
export type Colors = typeof light;
// Always the light look, even when the phone is in dark mode.
export function useColors(): Colors {
  return light;
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
