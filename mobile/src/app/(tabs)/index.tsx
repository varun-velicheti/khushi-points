import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, inr, rpc, when, type WalletShop } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { category, useColors } from "../../lib/theme";
import { Btn, Card, Loading, Note, Screen, ShopAvatar } from "../../components/ui";

export default function Wallet() {
  const c = useColors();
  const { me, version } = useAuth();
  const [list, setList] = useState<WalletShop[] | null>(null);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setList(await rpc<WalletShop[]>("app_wallet")); setErr(""); }
    catch (e) { setErr(errorText(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [version, load]);

  const hello = me?.name ? `Hi ${me.name.split(" ")[0]}` : "Your points";
  return (
    <Screen title={hello} subtitle={list?.length ? `Points at ${list.length} shop${list.length === 1 ? "" : "s"}. Each shop's points work only there.` : undefined}
      refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      {err ? <Note kind="err">{err}</Note> : null}
      {!list && !err && <Loading />}
      {list?.length === 0 && (
        <Card style={{ alignItems: "center", paddingVertical: 28, gap: 12 }}>
          <Ionicons name="qr-code" size={48} color={c.brand} />
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: "800", textAlign: "center" }}>Start earning at Khushi shops</Text>
          <Text style={{ color: c.muted, fontSize: 15, textAlign: "center", lineHeight: 21 }}>
            Show your QR at the counter when you pay. Your points from each shop appear here.
          </Text>
          <Btn title="Show my QR" icon="qr-code" onPress={() => router.navigate("/qr")} />
          {!me?.phone ? <Text style={{ color: c.muted, fontSize: 13, textAlign: "center" }}>Got points at a shop before? Add your mobile number in Profile to see them.</Text> : null}
        </Card>
      )}
      {list?.map((w) => (
        <Card key={w.shop_id} onPress={() => router.push(`/shop/${w.shop_id}`)} accessibilityLabel={`${w.name}, ${w.points} points`}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <ShopAvatar cat={w.category} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.ink, fontSize: 17, fontWeight: "800" }} numberOfLines={1}>{w.name}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                {[category(w.category).label, w.area].filter(Boolean).join(" · ")}{w.last_visit ? ` · ${when(w.last_visit)}` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: c.ink, fontSize: 24, fontWeight: "900" }}>{w.points}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>pts · {inr(w.value)}</Text>
            </View>
          </View>
          {w.expiring_30d > 0 && (
            <Text style={{ color: c.warn, fontSize: 13, fontWeight: "600" }}>{w.expiring_30d} points expire within 30 days</Text>
          )}
          {w.latest_offer ? (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: c.warnBg, borderRadius: 10, padding: 8 }}>
              <Ionicons name="pricetag" size={14} color={c.warn} />
              <Text style={{ color: c.warn, fontSize: 13, fontWeight: "600", flex: 1 }} numberOfLines={1}>{w.latest_offer}</Text>
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
