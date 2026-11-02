import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { callFn, errorText, rpc } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { registerForPush } from "../../lib/push";
import { supabase } from "../../lib/supabase";
import { useColors } from "../../lib/theme";
import { Btn, Card, Label, Note, Screen, s } from "../../components/ui";

const WEB = "https://khushi-points.vercel.app";

export default function Profile() {
  const c = useColors();
  const { me, refreshMe, bump } = useAuth();
  const [name, setName] = useState(me?.name ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState<string | null | false>(false);   // false = not sent, string = demo code
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = [s.input, { borderColor: c.line, backgroundColor: c.bg, color: c.ink }];
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

  async function saveName() {
    setBusy("name");
    try { await rpc("app_set_name", { p_name: name }); await refreshMe(); setMsg({ kind: "ok", text: "Name saved." }); }
    catch (e) { setMsg({ kind: "err", text: errorText(e) }); } finally { setBusy(null); }
  }
  async function sendCode() {
    setMsg(null);
    if (!/^[6-9]\d{9}$/.test(digits)) return setMsg({ kind: "err", text: errorText("BAD_MOBILE") });
    setBusy("send");
    try { const r = await callFn<{ demo_code?: string }>("customer-auth", { action: "send", phone: digits }); setCodeSent(r.demo_code ?? null); }
    catch (e) { setMsg({ kind: "err", text: errorText(e) }); } finally { setBusy(null); }
  }
  async function verifyCode() {
    setBusy("verify");
    try {
      const r = await callFn<{ ok: boolean; error?: string; linked_shops?: number }>("customer-auth", { action: "verify", phone: digits, code, attach: true });
      if (!r.ok) return setMsg({ kind: "err", text: errorText(r.error ?? "") });
      await refreshMe(); bump(); setCodeSent(false); setCode("");
      setMsg({ kind: "ok", text: r.linked_shops ? `Number added. Points from ${r.linked_shops} shop${r.linked_shops === 1 ? "" : "s"} are now in your wallet.` : "Number added." });
    } catch (e) { setMsg({ kind: "err", text: errorText(e) }); } finally { setBusy(null); }
  }
  async function notifications() {
    const r = await registerForPush();
    setMsg(r === "on" ? { kind: "ok", text: "Notifications are on." }
      : r === "off" ? { kind: "info", text: "Notifications are off. Turn them on in your phone's Settings for Khushi Points." }
      : { kind: "info", text: "Notifications are not available on this device yet." });
  }
  async function deleteAccount() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy("delete");
    try { await callFn("customer-auth", { action: "delete", phone: me?.phone ?? "9999999999" }); await supabase.auth.signOut(); }
    catch (e) { setMsg({ kind: "err", text: errorText(e) }); setConfirmDelete(false); } finally { setBusy(null); }
  }

  return (
    <Screen title="Profile">
      <Card>
        <Label>Your name</Label>
        <TextInput style={input} value={name} onChangeText={setName} placeholder="So shops can greet you" placeholderTextColor={c.muted} maxLength={60} accessibilityLabel="Your name" />
        <Btn title="Save name" kind="alt" onPress={saveName} busy={busy === "name"} />
      </Card>

      <Card>
        <Label>Mobile number</Label>
        {me?.phone ? (
          <>
            <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }}>+91 {me.phone.slice(0, 5)} {me.phone.slice(5)}</Text>
            <Text style={{ color: c.muted, fontSize: 14 }}>Shops can give you points by this number too. Points saved to it show in your wallet.</Text>
          </>
        ) : codeSent === false ? (
          <>
            <Text style={{ color: c.muted, fontSize: 14 }}>Add your number to collect points shops saved to it, and to earn when you forget your phone.</Text>
            <TextInput style={input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="98480 12345" placeholderTextColor={c.muted} maxLength={14} accessibilityLabel="Mobile number" />
            <Btn title="Send code" kind="alt" onPress={sendCode} busy={busy === "send"} />
          </>
        ) : (
          <>
            {codeSent ? <Note title="Test mode">{`No SMS was sent. Your code is ${codeSent}.`}</Note> : <Text style={{ color: c.muted }}>Enter the code we sent to {digits}.</Text>}
            <TextInput style={[...input, { letterSpacing: 8, textAlign: "center" }]} keyboardType="number-pad" value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ""))} maxLength={6} accessibilityLabel="Code from SMS" />
            <Btn title="Add number" onPress={verifyCode} busy={busy === "verify"} disabled={code.length !== 6} />
          </>
        )}
      </Card>

      {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>Expiry reminders</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>A note before your points at a shop expire. Sent at 10:30 AM.</Text>
          </View>
          <Switch value={me?.reminders ?? true} trackColor={{ true: c.brand, false: c.line }} accessibilityLabel="Expiry reminders"
            onValueChange={async (v) => { await rpc("app_set_reminders", { p_on: v }).catch(() => {}); refreshMe(); }} />
        </View>
      </Card>

      <Card>
        <Label>Sign-in</Label>
        <Text style={{ color: c.ink, fontSize: 15 }}>{me?.email && !me.email.endsWith("@phone.khushipoints.app") ? me.email : "Mobile number"}</Text>
        <Btn title="Notifications" kind="alt" icon="notifications" onPress={notifications} />
        <Btn title="Sign out" kind="alt" icon="log-out" onPress={() => supabase.auth.signOut()} />
      </Card>

      <Card>
        <Label>About</Label>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Btn title="Privacy policy" kind="link" onPress={() => WebBrowser.openBrowserAsync(`${WEB}/privacy`)} />
          <Btn title="Terms" kind="link" onPress={() => WebBrowser.openBrowserAsync(`${WEB}/terms`)} />
        </View>
        <Btn title={confirmDelete ? "Tap again to delete for good" : "Delete my account"} kind="danger" onPress={deleteAccount} busy={busy === "delete"} />
        {confirmDelete ? <Text style={{ color: c.muted, fontSize: 13 }}>This removes your app account, follows and notifications. Shops keep their own bill records.</Text> : null}
      </Card>
    </Screen>
  );
}
