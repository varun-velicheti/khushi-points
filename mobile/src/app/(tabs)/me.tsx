import { useEffect, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { callFn, errorText, rpc } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { registerForPush } from "../../lib/push";
import { supabase } from "../../lib/supabase";
import { useColors } from "../../lib/theme";
import { Btn, Card, GradientHeader, K, Label, ListRow, Note, Page, s } from "../../components/ui";

const WEB = "https://khushi-points.vercel.app";

export default function Profile() {
  const c = useColors();
  const { me, refreshMe, bump } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(me?.name ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [addingPhone, setAddingPhone] = useState(false);
  const [codeSent, setCodeSent] = useState<string | null | false>(false);   // false = not sent, string = test-mode code
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setName(me?.name ?? ""); }, [me?.name]);

  const input = [s.input, { borderColor: c.line, backgroundColor: c.bg, color: c.ink }];
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const initial = (me?.name ?? "").trim().charAt(0).toUpperCase() || "K";
  const isPhoneLogin = !me?.email || me.email.endsWith("@phone.khushipoints.app");

  async function saveName() {
    setBusy("name");
    try { await rpc("app_set_name", { p_name: name }); await refreshMe(); setEditingName(false); setMsg({ kind: "ok", text: "Name saved." }); }
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
      await refreshMe(); bump(); setCodeSent(false); setCode(""); setAddingPhone(false);
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
    <Page overlap={46} header={
      <GradientHeader title="Profile" tall>
        <View style={{ alignItems: "center", marginTop: 6 }}>
          <K w="semibold" s={14} c="rgba(255,255,255,0.92)">{me?.phone ? `+91 ${me.phone.slice(0, 5)} ${me.phone.slice(5)}` : isPhoneLogin ? " " : me?.email}</K>
        </View>
      </GradientHeader>
    }>
      {/* avatar card */}
      <Card style={{ alignItems: "center", paddingTop: 20 }}>
        <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: c.brand, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: c.brandSoft }}>
          <K w="heavy" s={30} c={c.brandInk}>{initial}</K>
        </View>
        {editingName ? (
          <View style={{ alignSelf: "stretch", gap: 8 }}>
            <TextInput style={input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={c.muted} maxLength={60} accessibilityLabel="Your name" autoFocus />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn title="Save" onPress={saveName} busy={busy === "name"} style={{ flex: 1 }} />
              <Btn title="Cancel" kind="alt" onPress={() => { setEditingName(false); setName(me?.name ?? ""); }} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            <K w="heavy" s={20}>{me?.name || "Add your name"}</K>
            <Btn title={me?.name ? "Edit name" : "Add name"} kind="link" icon="create-outline" onPress={() => setEditingName(true)} />
          </>
        )}
      </Card>

      {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}

      {!me?.phone && (
        <Card>
          <Label>Mobile number</Label>
          {!addingPhone ? (
            <>
              <K s={14} c={c.muted}>Add your number to collect points shops saved to it, and to earn when you forget your phone.</K>
              <Btn title="Add mobile number" kind="alt" icon="call" onPress={() => setAddingPhone(true)} />
            </>
          ) : codeSent === false ? (
            <>
              <TextInput style={input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="98480 12345" placeholderTextColor={c.muted} maxLength={14} accessibilityLabel="Mobile number" />
              <Btn title="Send code" onPress={sendCode} busy={busy === "send"} />
            </>
          ) : (
            <>
              {codeSent ? <Note title="Test mode">{`No SMS was sent. Your code is ${codeSent}.`}</Note> : <K c={c.muted}>Enter the code we sent to {digits}.</K>}
              <TextInput style={[...input, { letterSpacing: 8, textAlign: "center" }]} keyboardType="number-pad" value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ""))} maxLength={6} accessibilityLabel="Code from SMS" />
              <Btn title="Add number" onPress={verifyCode} busy={busy === "verify"} disabled={code.length !== 6} />
            </>
          )}
        </Card>
      )}

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow icon="time" label="Expiry reminders" detail="A note before points expire, at 10:30 AM"
          right={<Switch value={me?.reminders ?? true} trackColor={{ true: c.brand, false: c.line }} thumbColor="#FFFFFF" accessibilityLabel="Expiry reminders"
            onValueChange={async (v) => { await rpc("app_set_reminders", { p_on: v }).catch(() => {}); refreshMe(); }} />} />
        <ListRow icon="notifications" label="Notifications" detail="Points earned, offers, approvals" onPress={notifications} />
        <ListRow icon="receipt" label="Activity" detail="Points earned and used" onPress={() => router.push("/activity")} />
      </Card>

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow icon="shield-checkmark" label="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(`${WEB}/privacy`)} />
        <ListRow icon="document-text" label="Terms" onPress={() => WebBrowser.openBrowserAsync(`${WEB}/terms`)} />
        <ListRow icon="log-out" label="Sign out" onPress={() => supabase.auth.signOut()} />
        <ListRow icon="trash" label={confirmDelete ? "Tap again to delete for good" : "Delete my account"} danger onPress={deleteAccount}
          detail={confirmDelete ? "Removes your app account, follows and notifications. Shops keep their own bill records." : undefined} />
      </Card>
    </Page>
  );
}
