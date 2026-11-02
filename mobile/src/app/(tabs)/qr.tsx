import { Text, View } from "react-native";
import { router } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { useAuth } from "../../lib/auth";
import { useColors } from "../../lib/theme";
import { Btn, Card, Loading, Screen } from "../../components/ui";

export default function MyQR() {
  const c = useColors();
  const { me } = useAuth();
  return (
    <Screen title="My QR" subtitle="Show this at the counter to earn or use points.">
      {!me ? <Loading /> : (
        <Card style={{ alignItems: "center", paddingVertical: 28, gap: 14 }}>
          <View style={{ backgroundColor: "#FFFFFF", padding: 16, borderRadius: 16 }} accessible accessibilityLabel={`Your Khushi Points QR, member code ${me.member_code}`}>
            <QRCode value={`KP:${me.member_code}`} size={230} color="#0D2420" backgroundColor="#FFFFFF" />
          </View>
          <Text style={{ color: c.muted, fontSize: 13 }}>Member code</Text>
          <Text selectable style={{ color: c.ink, fontSize: 28, fontWeight: "900", letterSpacing: 4 }}>{me.member_code}</Text>
          {me.name ? <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{me.name}</Text> : null}
          <Text style={{ color: c.muted, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
            The cashier scans this to add your points. To use points, you approve on this phone, so nobody else can spend them.
          </Text>
        </Card>
      )}
      {me && !me.phone ? (
        <Card>
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700" }}>No smartphone with you next time?</Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>Add your mobile number, and shops can also give you points by number.</Text>
          <Btn title="Add mobile number" kind="alt" onPress={() => router.navigate("/me")} />
        </Card>
      ) : null}
    </Screen>
  );
}
