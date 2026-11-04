import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, rpc, shortDate, when, type FeedOffer } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useColors } from "../../lib/theme";
import { Card, GradientHeader, K, Loading, Note, Page, ShopAvatar } from "../../components/ui";

export default function Offers() {
  const c = useColors();
  const { version } = useAuth();
  const [list, setList] = useState<FeedOffer[] | null>(null);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setList(await rpc<FeedOffer[]>("app_offers")); setErr(""); } catch (e) { setErr(errorText(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [version, load]);

  return (
    <Page overlap={0} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      header={<GradientHeader title="Offers" />}>
      <K s={13.5} c={c.muted} style={{ marginTop: 16 }}>From shops you follow. Each shop sends at most 2 a week.</K>
      {err ? <Note kind="err">{err}</Note> : null}
      {!list && !err && <Loading />}
      {list?.length === 0 && (
        <Card style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="pricetags" size={28} color={c.brand} />
          </View>
          <K w="bold" s={16}>No offers right now</K>
          <K s={14} c={c.muted} style={{ textAlign: "center" }}>You follow a shop automatically after your first bill there.</K>
        </Card>
      )}
      {list?.map((o) => (
        <Card key={o.offer_id} onPress={() => router.push(`/shop/${o.shop_id}`)} accessibilityLabel={`${o.shop_name}: ${o.title}`} style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          {/* shop logo, or a ticket-style badge */}
          {o.logo_path ? <ShopAvatar logo={o.logo_path} size={64} /> : (
            <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="gift" size={30} color={c.brand} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <K w="bold" s={12.5} c={c.brand} numberOfLines={1}>{o.shop_name}</K>
            <K w="heavy" s={16} numberOfLines={2}>{o.title}</K>
            {o.body ? <K s={13} c={c.muted} numberOfLines={2}>{o.body}</K> : null}
            <K s={12} c={o.valid_until ? c.warn : c.muted}>{o.valid_until ? `Valid until ${shortDate(o.valid_until)}` : when(o.created_at)}</K>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.muted} />
        </Card>
      ))}
    </Page>
  );
}
