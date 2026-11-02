import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, inr, rpc, shortDate, when, type ShopDetail } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { category, useColors } from "../../lib/theme";
import { Card, Label, Loading, Note, Screen, ShopAvatar } from "../../components/ui";

export default function ShopPage() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { version } = useAuth();
  const [d, setD] = useState<ShopDetail | null>(null);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setD(await rpc<ShopDetail>("app_shop", { p_shop: id })); setErr(""); } catch (e) { setErr(errorText(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [version, load]);

  async function follow(v: boolean) {
    if (!d) return;
    setD({ ...d, following: v });
    try { await rpc("app_follow", { p_shop: id, p_follow: v }); } catch { setD({ ...d, following: !v }); }
  }

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} accessibilityRole="button" accessibilityLabel="Back"
      style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 }}>
      <Ionicons name="chevron-back" size={22} color={c.brand} /><Text style={{ color: c.brand, fontSize: 16, fontWeight: "600" }}>Wallet</Text>
    </Pressable>
  );
  if (!d) return <Screen>{back}{err ? <Note kind="err">{err}</Note> : <Loading />}</Screen>;
  const s = d.shop;
  const place = [s.area, s.city].filter(Boolean).join(", ");
  const maps = s.lat != null && s.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
    : s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name}, ${s.address}`)}` : null;

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      {back}
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <ShopAvatar cat={s.category} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: "900" }} accessibilityRole="header">{s.name}</Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>{[category(s.category).label, place].filter(Boolean).join(" · ")}</Text>
        </View>
      </View>

      <Card style={{ backgroundColor: c.brand, borderColor: c.brand }}>
        <Text style={{ color: c.brandInk, opacity: 0.85, fontSize: 13, fontWeight: "700" }}>YOUR POINTS HERE</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text style={{ color: c.brandInk, fontSize: 44, fontWeight: "900" }}>{d.points}</Text>
          <Text style={{ color: c.brandInk, fontSize: 16 }}>worth {inr(d.value)}</Text>
        </View>
        <Text style={{ color: c.brandInk, opacity: 0.9, fontSize: 13, lineHeight: 19 }}>
          {Number(s.earn_pct)}% back on every bill · use from {s.min_redeem} points, up to {s.max_redeem_pct}% of a bill · points last {s.expiry_days} days.
          Only usable at {s.name}.
        </Text>
      </Card>

      {d.expiring.length > 0 && (
        <Note title="Use them soon">{d.expiring.map((x) => `${x.points} points expire on ${shortDate(x.expires_at)}`).join("\n")}</Note>
      )}

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>Follow {s.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>Get their offers as notifications. At most 2 a week.</Text>
          </View>
          <Switch value={d.following} onValueChange={follow} trackColor={{ true: c.brand, false: c.line }} accessibilityLabel={`Follow ${s.name}`} />
        </View>
      </Card>

      {d.offers.length > 0 && <Label style={{ marginTop: 6 }}>Offers</Label>}
      {d.offers.map((o) => (
        <Card key={o.id} style={{ borderColor: c.accent }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: "800" }}>{o.title}</Text>
          {o.body ? <Text style={{ color: c.muted, fontSize: 14 }}>{o.body}</Text> : null}
          <Text style={{ color: c.muted, fontSize: 12 }}>{when(o.created_at)}{o.valid_until ? ` · valid until ${shortDate(o.valid_until)}` : ""}</Text>
        </Card>
      ))}

      {(s.about || s.address || s.hours || s.contact_phone) && (
        <Card>
          {s.about ? <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{s.about}</Text> : null}
          {s.hours ? <Info icon="time-outline" text={s.hours} /> : null}
          {s.address ? <Info icon="location-outline" text={s.address} onPress={maps ? () => Linking.openURL(maps) : undefined} action="Directions" /> : null}
          {s.contact_phone ? <Info icon="call-outline" text={s.contact_phone} onPress={() => Linking.openURL(`tel:${s.contact_phone}`)} action="Call" /> : null}
        </Card>
      )}

      <Label style={{ marginTop: 6 }}>History</Label>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {d.history.length === 0 ? <Text style={{ color: c.muted, paddingVertical: 10 }}>No visits yet.</Text> : d.history.map((h, i) => {
          const sign = h.kind === "earn" ? "+" : "−";
          const col = h.undone ? c.muted : h.kind === "earn" ? c.good : h.kind === "redeem" ? c.ink : c.bad;
          const title = h.kind === "earn" ? `Bill ${h.amount != null ? inr(h.amount) : ""}` : h.kind === "redeem" ? `Used on a ${inr(h.amount ?? 0)} bill` : "Expired";
          return (
            <View key={i} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600", textDecorationLine: h.undone ? "line-through" : "none" }}>
                  {title}{h.undone ? " (undone)" : ""}
                </Text>
                <Text style={{ color: col, fontSize: 15, fontWeight: "800" }}>{sign}{h.points}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12 }}>{when(h.at)}{h.bill_no ? ` · ${h.bill_no}` : ""}</Text>
              {h.note ? <Text style={{ color: c.muted, fontSize: 13 }}>{h.note}</Text> : null}
            </View>
          );
        })}
      </Card>
    </Screen>
  );

  function Info({ icon, text, onPress, action }: { icon: keyof typeof Ionicons.glyphMap; text: string; onPress?: () => void; action?: string }) {
    return (
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "link" : undefined}
        style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 4 }}>
        <Ionicons name={icon} size={18} color={c.muted} />
        <Text style={{ color: c.ink, fontSize: 14, flex: 1 }}>{text}</Text>
        {action ? <Text style={{ color: c.brand, fontWeight: "700" }}>{action}</Text> : null}
      </Pressable>
    );
  }
}
