import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { errorText, inr, rpc, when, type Activity, type FeedOffer, type WalletShop } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { category, useColors } from "../../lib/theme";
import ActivityRow from "../../components/ActivityRow";
import { Btn, Card, GradientHeader, HeaderButton, IconTile, K, Loading, LogoMark, Note, Page, SectionTitle, ShopAvatar } from "../../components/ui";

export default function Home() {
  const c = useColors();
  const { me, version } = useAuth();
  const [list, setList] = useState<WalletShop[] | null>(null);
  const [recent, setRecent] = useState<Activity[]>([]);
  const [offers, setOffers] = useState<FeedOffer[]>([]);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, a, o] = await Promise.all([
        rpc<WalletShop[]>("app_wallet"), rpc<Activity[]>("app_activity", { p_limit: 4 }), rpc<FeedOffer[]>("app_offers"),
      ]);
      setList(w); setRecent(a); setOffers(o); setErr("");
    } catch (e) { setErr(errorText(e)); }
  }, []);
  // refresh when shown, and every 20 seconds while open (in case a notification is missed)
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]));
  useEffect(() => { load(); }, [version, load]);

  const total = (list ?? []).reduce((a, w) => a + w.points, 0);
  const value = (list ?? []).reduce((a, w) => a + Number(w.value), 0);
  const expiring = (list ?? []).reduce((a, w) => a + w.expiring_30d, 0);
  const first = me?.name?.split(" ")[0];

  return (
    <Page refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} overlap={56}
      header={
        <GradientHeader tall left={<LogoMark size={38} />} title="Khushi Points"
          right={<HeaderButton icon="notifications-outline" label="Offers" onPress={() => router.navigate("/offers")} />}>
          <K w="semibold" s={14} c="rgba(255,255,255,0.9)" style={{ marginTop: 10 }}>{first ? `Hi ${first}, welcome back` : "Welcome back"}</K>
        </GradientHeader>
      }>
      {/* points summary */}
      <Card onPress={() => router.navigate("/qr")} accessibilityLabel={`${total} points across ${list?.length ?? 0} shops. Show my QR`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="star" size={28} color={c.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <K s={13} c={c.muted}>Your points</K>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <K w="heavy" s={28}>{total.toLocaleString("en-IN")}</K>
              <K w="semibold" s={13} c={c.muted}>({inr(value)})</K>
            </View>
            <K s={12} c={c.muted}>{list ? `At ${list.length} shop${list.length === 1 ? "" : "s"} · each shop's points work only there` : " "}</K>
          </View>
          <Ionicons name="chevron-forward" size={22} color={c.muted} />
        </View>
        {expiring > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.warnBg, borderRadius: 10, padding: 8, marginTop: 4 }}>
            <Ionicons name="time-outline" size={16} color={c.warn} />
            <K w="semibold" s={13} c={c.warn}>{expiring} points expire within 30 days</K>
          </View>
        ) : null}
      </Card>

      {/* quick actions */}
      <Card style={{ flexDirection: "row", paddingVertical: 18 }}>
        <IconTile icon="qr-code" label="My QR" onPress={() => router.navigate("/qr")} />
        <IconTile icon="pricetags" label="Offers" onPress={() => router.navigate("/offers")} />
        <IconTile icon="receipt" label="Activity" onPress={() => router.push("/activity")} />
        <IconTile icon="person" label="Profile" onPress={() => router.navigate("/me")} />
      </Card>

      {err ? <Note kind="err">{err}</Note> : null}
      {!list && !err && <Loading />}

      {list?.length === 0 && (
        <Card style={{ alignItems: "center", paddingVertical: 26, gap: 10 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="storefront" size={34} color={c.brand} />
          </View>
          <K w="heavy" s={18} style={{ textAlign: "center" }}>Start earning at Khushi shops</K>
          <K s={14} c={c.muted} style={{ textAlign: "center" }}>Show your QR at the counter when you pay. Points from each shop appear here.</K>
          <Btn title="Show my QR" icon="qr-code" onPress={() => router.navigate("/qr")} style={{ alignSelf: "stretch" }} />
          {!me?.phone ? <K s={13} c={c.muted} style={{ textAlign: "center" }}>Got points before? Add your mobile number in Profile to see them.</K> : null}
        </Card>
      )}

      {/* your shops, as round avatars */}
      {list && list.length > 0 && <>
        <SectionTitle title="Your shops" />
        <FlatList horizontal data={list} keyExtractor={(w) => w.shop_id} showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingRight: 8 }}
          renderItem={({ item: w }) => (
            <Pressable onPress={() => router.push(`/shop/${w.shop_id}`)} accessibilityRole="button" accessibilityLabel={`${w.name}, ${w.points} points`}
              style={{ width: 76, alignItems: "center", gap: 6 }}>
              <ShopAvatar cat={w.category} logo={w.logo_path} size={64} />
              <K w="semibold" s={12} numberOfLines={1} style={{ textAlign: "center" }}>{w.name}</K>
              <K w="bold" s={12} c={c.brand}>{w.points} pts</K>
            </Pressable>
          )} />
      </>}

      {/* offers carousel */}
      {offers.length > 0 && <>
        <SectionTitle title="Offers for you" action="View all" onAction={() => router.navigate("/offers")} />
        <FlatList horizontal data={offers.slice(0, 6)} keyExtractor={(o) => String(o.offer_id)} showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 8 }}
          renderItem={({ item: o }) => (
            <Pressable onPress={() => router.push(`/shop/${o.shop_id}`)} accessibilityRole="button" accessibilityLabel={`${o.shop_name}: ${o.title}`}>
              <LinearGradient colors={[c.gradTop, c.gradBottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: 250, minHeight: 128, borderRadius: 20, padding: 16, gap: 6, justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="pricetag" size={14} color="#FFFFFF" />
                  <K w="bold" s={12} c="rgba(255,255,255,0.9)" numberOfLines={1} style={{ flex: 1 }}>{o.shop_name}</K>
                </View>
                <K w="heavy" s={17} c="#FFFFFF" numberOfLines={2}>{o.title}</K>
                <K w="semibold" s={12} c="rgba(255,255,255,0.85)">{o.valid_until ? `Valid until ${new Date(o.valid_until).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Tap to see the shop"}</K>
              </LinearGradient>
            </Pressable>
          )} />
      </>}

      {/* points by shop */}
      {list && list.length > 0 && <>
        <SectionTitle title="Points by shop" />
        {list.map((w) => (
          <Card key={w.shop_id} onPress={() => router.push(`/shop/${w.shop_id}`)} accessibilityLabel={`${w.name}, ${w.points} points`}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <ShopAvatar cat={w.category} logo={w.logo_path} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <K w="bold" s={16} numberOfLines={1}>{w.name}</K>
                <K s={12.5} c={c.muted} numberOfLines={1}>
                  {[category(w.category).label, w.area].filter(Boolean).join(" · ")}{w.last_visit ? ` · ${when(w.last_visit)}` : ""}
                </K>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <K w="heavy" s={20}>{w.points}</K>
                <K s={11.5} c={c.muted}>pts · {inr(w.value)}</K>
              </View>
            </View>
            {w.expiring_30d > 0 ? <K w="semibold" s={12.5} c={c.warn}>{w.expiring_30d} points expire within 30 days</K> : null}
          </Card>
        ))}
      </>}

      {/* recent activity */}
      {recent.length > 0 && <>
        <SectionTitle title="Recent activity" action="See all" onAction={() => router.push("/activity")} />
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {recent.map((a, i) => <ActivityRow key={i} a={a} first={i === 0} />)}
        </Card>
      </>}
    </Page>
  );
}
