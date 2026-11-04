import { View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../../lib/auth";
import { useColors } from "../../lib/theme";
import { Btn, K, Loading, LogoMark } from "../../components/ui";

// Full coral screen with a white "pass" card, like a voucher.
export default function MyQR() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  return (
    <LinearGradient colors={[c.gradTop, c.gradBottom]} style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: 20 }}>
      <View style={{ alignItems: "center", gap: 6, marginBottom: 18 }}>
        <LogoMark size={44} />
        <K w="heavy" s={22} c="#FFFFFF" accessibilityRole="header">My QR</K>
        <K s={14} c="rgba(255,255,255,0.9)" style={{ textAlign: "center" }}>Show this at the counter to earn or use points</K>
      </View>
      <View style={{ backgroundColor: c.surface, borderRadius: 28, padding: 22, alignItems: "center", gap: 12 }}>
        {!me ? <Loading /> : <>
          <View style={{ backgroundColor: "#FFFFFF", padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#F2E4E7" }}
            accessible accessibilityLabel={`Your Khushi Points QR, member code ${me.member_code}`}>
            <QRCode value={`KP:${me.member_code}`} size={220} color="#1F1416" backgroundColor="#FFFFFF" />
          </View>
          {/* dashed tear line, like a pass */}
          <View style={{ alignSelf: "stretch", borderTopWidth: 1.5, borderStyle: "dashed", borderColor: c.line, marginVertical: 4 }} />
          <K s={13} c={c.muted}>Member code</K>
          <K w="heavy" s={28} selectable style={{ letterSpacing: 4 }}>{me.member_code}</K>
          {me.name ? <K w="semibold" s={16}>{me.name}</K> : null}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: c.brandSoft, borderRadius: 14, padding: 12 }}>
            <Ionicons name="shield-checkmark" size={18} color={c.brand} />
            <K s={13} c={c.ink} style={{ flex: 1 }}>The cashier scans this to add points. To use points, you approve on this phone, so nobody else can spend them.</K>
          </View>
        </>}
      </View>
      {me && !me.phone ? (
        <Btn title="Add your mobile number" kind="white" icon="call" onPress={() => router.navigate("/me")} style={{ marginTop: 16 }} />
      ) : null}
    </LinearGradient>
  );
}
