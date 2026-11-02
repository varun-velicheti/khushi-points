import { useColorScheme } from "react-native";

// Same palette as the shop app: teal ledger ink, marigold for money moments.
const light = {
  bg: "#F2F5F4", surface: "#FFFFFF", sunk: "#E8EEEC", ink: "#10201D", muted: "#566864", line: "#D5DFDC",
  brand: "#0D5C55", brandInk: "#FFFFFF", accent: "#E3A11A", accentInk: "#2A1C00",
  good: "#17733F", goodBg: "#E2F3E8", bad: "#B0281F", badBg: "#FBE7E5", warn: "#8A5800", warnBg: "#FCF0D6",
};
const dark: typeof light = {
  bg: "#0C1413", surface: "#141F1E", sunk: "#1B2826", ink: "#E4EDEB", muted: "#93A6A2", line: "#283836",
  brand: "#56B8AC", brandInk: "#05211E", accent: "#F0B53C", accentInk: "#2A1C00",
  good: "#63C98F", goodBg: "#15301F", bad: "#FF8C82", badBg: "#3A1714", warn: "#F0B53C", warnBg: "#352808",
};
export type Colors = typeof light;
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

const CAT: Record<string, { label: string; icon: string }> = {
  restaurant: { label: "Restaurant", icon: "restaurant" }, cafe: { label: "Café", icon: "cafe" },
  bakery: { label: "Bakery", icon: "pizza" }, sweets: { label: "Sweets", icon: "gift" },
  icecream: { label: "Ice cream", icon: "ice-cream" }, grocery: { label: "Grocery", icon: "basket" },
  supermarket: { label: "Supermarket", icon: "cart" }, clothing: { label: "Clothing", icon: "shirt" },
  salon: { label: "Salon", icon: "cut" }, pharmacy: { label: "Pharmacy", icon: "medkit" },
  electronics: { label: "Electronics", icon: "phone-portrait" }, other: { label: "Shop", icon: "storefront" },
};
export const category = (c?: string | null) => CAT[c ?? "other"] ?? CAT.other;
