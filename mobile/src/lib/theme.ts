// Kushly customer app = the shopper side of kushly Rewards: marigold, with indigo text on it.
// brand: fills (headers, buttons, badges); brandInk/onBrand: text on brand; brandText: coloured text and icons on white.
const light = {
  bg: "#F6F7FA", surface: "#FFFFFF", sunk: "#F1F2F6", ink: "#16181D", muted: "#5F6472", line: "#E6E8EE",
  brand: "#F4A21B", brandDeep: "#D98A0A", brandSoft: "#FDF1DC", brandInk: "#23246B", brandText: "#23246B",
  onBrand: "#23246B", onBrandMuted: "rgba(35, 36, 107, 0.78)",
  gradTop: "#F7B640", gradBottom: "#F09A12",
  accent: "#F4A21B", accentInk: "#23246B", indigo: "#23246B", coral: "#FF7A59", teal: "#2BB5A0", cream: "#FBF8F2",
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
