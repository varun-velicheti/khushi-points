import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, inr, rpc, shortDate, when, type ShopDetail } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { category, useColors } from "../../lib/theme";
import { Card, GradientHeader, HeaderButton, K, Loading, Note, Page, SectionTitle, ShopAvatar, type IconName } from "../../components/ui";

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

  const back = <HeaderButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
  if (!d) return (
    <Page header={<GradientHeader left={back} title="Shop" />}>
      <View style={{ height: 16 }} />
      {err ? <Note kind="err">{err}</Note> : <Loading />}
    </Page>
  );

  const s = d.shop;
  const place = [s.area, s.city].filter(Boolean).join(", ");
  const maps = s.lat != null && s.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
    : s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name}, ${s.address}`)}` : null;

  return (
    <Page refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} overlap={52}
      header={
        <GradientHeader tall left={back}>
          <View style={{ alignItems: "center", gap: 6, marginTop: 2 }}>
            <View style={{ borderRadius: 40, borderWidth: 4, borderColor: "rgba(255,255,255,0.35)" }}>
              <ShopAvatar cat={s.category} logo={s.logo_path} size={68} onBrand />
            </View>
            <K w="heavy" s={22} c="#FFFFFF" accessibilityRole="header" style={{ textAlign: "center" }}>{s.name}</K>
            <K w="semibold" s={13} c="rgba(255,255,255,0.9)" style={{ textAlign: "center" }}>{[category(s.category).label, place].filter(Boolean).join(" · ")}</K>
          </View>
        </GradientHeader>
      }>
      {/* points here */}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="star" size={28} color={c.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <K s={13} c={c.muted}>Your points here</K>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <K w="heavy" s={30}>{d.points}</K>
              <K w="semibold" s={14} c={c.muted}>worth {inr(d.value)}</K>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Fact top={`${Number(s.earn_pct)}%`} label="back on bills" />
          <Fact top={`${s.min_redeem}`} label="pts to use" />
          <Fact top={`${s.expiry_days}d`} label="points last" />
        </View>
        <K s={12.5} c={c.muted}>Use up to {s.max_redeem_pct}% of a bill. Points work only at {s.name}.</K>
      </Card>

      {/* Regular status: progress over the last 90 days */}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: d.is_regular ? c.accent : c.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={d.is_regular ? "star" : "star-outline"} size={22} color={d.is_regular ? "#FFFFFF" : c.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <K w="bold" s={16}>{d.is_regular ? `You're a Regular here` : `${Math.max(0, s.regular_visits - d.visits_90d)} more visit${s.regular_visits - d.visits_90d === 1 ? "" : "s"} to become a Regular`}</K>
            <K s={13} c={c.muted}>{d.is_regular
              ? `Visit ${s.regular_visits} times every 90 days to keep it.`
              : `${s.regular_visits} visits in 90 days makes you a Regular at ${s.name}.`}</K>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 5, marginTop: 6 }} accessibilityLabel={`${Math.min(d.visits_90d, s.regular_visits)} of ${s.regular_visits} visits in the last 90 days`}>
          {Array.from({ length: s.regular_visits }, (_, i) => (
            <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < d.visits_90d ? (d.is_regular ? c.accent : c.brand) : c.sunk }} />
          ))}
        </View>
        <K s={12} c={c.muted}>{d.visits_90d} visit{d.visits_90d === 1 ? "" : "s"} in the last 90 days · {d.visits} in total</K>
      </Card>

      {d.expiring.length > 0 && (
        <Note title="Use them soon">{d.expiring.map((x) => `${x.points} points expire on ${shortDate(x.expires_at)}`).join("\n")}</Note>
      )}

      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={d.following ? "heart" : "heart-outline"} size={20} color={c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <K w="bold" s={15}>Follow {s.name}</K>
          <K s={13} c={c.muted}>Get their offers as notifications. At most 2 a week.</K>
        </View>
        <Switch value={d.following} onValueChange={follow} trackColor={{ true: c.brand, false: c.line }} thumbColor="#FFFFFF" accessibilityLabel={`Follow ${s.name}`} />
      </Card>

      {d.offers.length > 0 && <SectionTitle title="Offers" />}
      {d.offers.map((o) => (
        <Card key={o.id} style={{ borderLeftWidth: 4, borderLeftColor: c.brand }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="pricetag" size={16} color={c.brand} />
            <K w="heavy" s={16} style={{ flex: 1 }}>{o.title}</K>
          </View>
          {o.body ? <K s={14} c={c.muted}>{o.body}</K> : null}
          <K s={12} c={c.muted}>{when(o.created_at)}{o.valid_until ? ` · valid until ${shortDate(o.valid_until)}` : ""}</K>
        </Card>
      ))}

      {(s.about || s.address || s.hours || s.contact_phone) && <>
        <SectionTitle title="About" />
        <Card>
          {s.about ? <K s={15} style={{ marginBottom: 4 }}>{s.about}</K> : null}
          {s.hours ? <Info icon="time" text={s.hours} /> : null}
          {s.address ? <Info icon="location" text={s.address} onPress={maps ? () => Linking.openURL(maps) : undefined} action="Directions" /> : null}
          {s.contact_phone ? <Info icon="call" text={s.contact_phone} onPress={() => Linking.openURL(`tel:${s.contact_phone}`)} action="Call" /> : null}
        </Card>
      </>}

      <SectionTitle title="History" />
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {d.history.length === 0 ? <K c={c.muted} style={{ paddingVertical: 10 }}>No visits yet.</K> : d.history.map((h, i) => {
          const sign = h.kind === "earn" ? "+" : "−";
          const col = h.undone ? c.muted : h.kind === "earn" ? c.good : h.kind === "redeem" ? c.ink : c.bad;
          const title = h.kind === "earn" ? `Bill ${h.amount != null ? inr(h.amount) : ""}` : h.kind === "redeem" ? `Used on a ${inr(h.amount ?? 0)} bill` : "Expired";
          const icon: IconName = h.kind === "earn" ? "add-circle" : h.kind === "redeem" ? "gift" : "hourglass";
          return (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={icon} size={18} color={c.brand} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <K w="semibold" s={15} style={{ textDecorationLine: h.undone ? "line-through" : "none" }}>{title}{h.undone ? " (undone)" : ""}</K>
                <K s={12} c={c.muted}>{when(h.at)}{h.bill_no ? ` · ${h.bill_no}` : ""}</K>
                {h.note ? <K s={13} c={c.muted}>{h.note}</K> : null}
              </View>
              <K w="heavy" s={16} c={col}>{sign}{h.points}</K>
            </View>
          );
        })}
      </Card>
    </Page>
  );

  function Fact({ top, label }: { top: string; label: string }) {
    return (
      <View style={{ flex: 1, backgroundColor: c.sunk, borderRadius: 14, paddingVertical: 10, alignItems: "center" }}>
        <K w="heavy" s={16} c={c.brand}>{top}</K>
        <K s={11.5} c={c.muted}>{label}</K>
      </View>
    );
  }

  function Info({ icon, text, onPress, action }: { icon: IconName; text: string; onPress?: () => void; action?: string }) {
    return (
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "link" : undefined}
        style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 6 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={16} color={c.brand} />
        </View>
        <K s={14} style={{ flex: 1 }}>{text}</K>
        {action ? <K w="bold" s={14} c={c.brand}>{action}</K> : null}
      </Pressable>
    );
  }
}
