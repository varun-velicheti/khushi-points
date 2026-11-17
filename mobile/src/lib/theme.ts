// Kushly look: navy brand with orange, coral and teal accents (from the logo), white rounded cards.
const light = {
  bg: "#F6F7FA", surface: "#FFFFFF", sunk: "#F1F2F6", ink: "#16181D", muted: "#5F6472", line: "#E6E8EE",
  brand: "#23256B", brandDeep: "#181A52", brandSoft: "#ECECF7", brandInk: "#FFFFFF",
  gradTop: "#2F3290", gradBottom: "#1B1D58",
  accent: "#F3A31A", accentInk: "#23256B", coral: "#FF7A5A", teal: "#2BB5A0", cream: "#FBF8F2",
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
