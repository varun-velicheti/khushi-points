import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, rpc, shortDate, when, type FeedOffer } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useColors } from "../../lib/theme";
import { Card, Loading, Note, Screen } from "../../components/ui";

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
    <Screen title="Offers" subtitle="From shops you follow. Each shop can send at most 2 a week."
      refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      {err ? <Note kind="err">{err}</Note> : null}
      {!list && !err && <Loading />}
      {list?.length === 0 && (
        <Card style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
          <Ionicons name="pricetags-outline" size={40} color={c.muted} />
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>No offers right now</Text>
          <Text style={{ color: c.muted, fontSize: 14, textAlign: "center" }}>You follow a shop automatically after your first bill there.</Text>
        </Card>
      )}
      {list?.map((o) => (
        <Card key={o.offer_id} onPress={() => router.push(`/shop/${o.shop_id}`)} accessibilityLabel={`${o.shop_name}: ${o.title}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: c.brand, fontWeight: "700", fontSize: 13, flex: 1 }} numberOfLines={1}>{o.shop_name}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>{when(o.created_at)}</Text>
          </View>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "800" }}>{o.title}</Text>
          {o.body ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{o.body}</Text> : null}
          {o.valid_until ? <Text style={{ color: c.warn, fontSize: 13, fontWeight: "600" }}>Valid until {shortDate(o.valid_until)}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}
