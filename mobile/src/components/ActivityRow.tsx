import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { inr, when, type Activity } from "../lib/api";
import { useColors } from "../lib/theme";
import { K } from "./ui";

export default function ActivityRow({ a, first }: { a: Activity; first: boolean }) {
  const c = useColors();
  const earn = a.kind === "earn";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: earn ? c.goodBg : c.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={earn ? "add" : "gift"} size={20} color={earn ? c.good : c.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <K w="semibold" s={14.5} numberOfLines={1}>{earn ? "Points earned" : "Points used"} · {a.shop_name}</K>
        <K s={12} c={c.muted}>{when(a.at)} · bill {inr(a.amount)}</K>
      </View>
      <K w="heavy" s={16} c={earn ? c.good : c.brand}>{earn ? "+" : "−"}{a.points}</K>
    </View>
  );
}
