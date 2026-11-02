import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { callFn, errorText, rpc } from "../lib/api";
import { features, supabase } from "../lib/supabase";
import { useColors } from "../lib/theme";
import { Btn, Label, Note, Screen, s } from "../components/ui";

WebBrowser.maybeCompleteAuthSession();
const WEB = "https://khushi-points.vercel.app";

export default function SignIn() {
  const c = useColors();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [demo, setDemo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

  async function send() {
    setErr("");
    if (!/^[6-9]\d{9}$/.test(digits)) return setErr(errorText("BAD_MOBILE"));
    setBusy("send");
    try {
      const r = await callFn<{ sent: boolean; demo_code?: string }>("customer-auth", { action: "send", phone: digits });
      setDemo(r.demo_code ?? null); setCode(""); setStep("code");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  }

  async function verify() {
    setErr(""); setBusy("verify");
    try {
      const r = await callFn<{ ok: boolean; error?: string; tries_left?: number; email?: string; password?: string }>(
        "customer-auth", { action: "verify", phone: digits, code: code.trim() });
      if (!r.ok) {
        setErr(r.error === "WRONG_OTP" ? `That code is not right. ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left.` : errorText(r.error ?? ""));
        if (r.error !== "WRONG_OTP") setStep("phone");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: r.email!, password: r.password! });
      if (error) throw error;
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  }

  async function google() {
    setErr(""); setBusy("google");
    try {
      if (Platform.OS === "web") {
        await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
        return;
      }
      const redirectTo = Linking.createURL("sign-in");
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data.url) throw error ?? new Error("SIGNIN_FAILED");
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== "success") return;
      const authCode = new URL(res.url).searchParams.get("code");
      if (!authCode) throw new Error("SIGNIN_FAILED");
      const { error: e2 } = await supabase.auth.exchangeCodeForSession(authCode);
      if (e2) throw e2;
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  }

  async function apple() {
    setErr(""); setBusy("apple");
    try {
      const rawNonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error("SIGNIN_FAILED");
      const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: cred.identityToken, nonce: rawNonce });
      if (error) throw error;
      const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
      if (name) await rpc("app_set_name", { p_name: name }).catch(() => {});
    } catch (e) {
      if ((e as { code?: string })?.code !== "ERR_REQUEST_CANCELED") setErr(errorText(e));
    } finally { setBusy(null); }
  }

  const input = [s.input, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ gap: 10, marginTop: 24, marginBottom: 8 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: c.brandInk, fontSize: 28, fontWeight: "900" }}>K</Text>
          </View>
          <Text style={[s.h1, { color: c.ink, fontSize: 32 }]} accessibilityRole="header">Your points from every shop, in one place</Text>
          <Text style={{ color: c.muted, fontSize: 16, lineHeight: 23 }}>
            Earn at Khushi shops near you, see your points, and get offers from shops you like. No SMS or WhatsApp messages.
          </Text>
        </View>

        {step === "phone" ? (
          <View style={{ gap: 10 }}>
            <Label>Mobile number</Label>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[...input, { justifyContent: "center", paddingHorizontal: 12 }]}><Text style={{ color: c.ink, fontSize: 18 }}>+91</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextInput style={[...input, { width: "100%" }]} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
                  value={phone} onChangeText={setPhone} placeholder="98480 12345" placeholderTextColor={c.muted} maxLength={14}
                  accessibilityLabel="Mobile number" onSubmitEditing={send} />
              </View>
            </View>
            <Text style={{ color: c.muted, fontSize: 13 }}>Use the number you give at shops, so your saved points show up. We send one code by SMS, only now.</Text>
            <Btn title="Send code" onPress={send} busy={busy === "send"} disabled={!!busy && busy !== "send"} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Label>Code sent to +91 {digits.slice(0, 5)} {digits.slice(5)}</Label>
            {demo ? <Note title="Test mode">{`No SMS was sent. Your code is ${demo}.`}</Note> : null}
            <TextInput style={[...input, { letterSpacing: 8, textAlign: "center", fontSize: 24 }]} keyboardType="number-pad"
              autoComplete="sms-otp" textContentType="oneTimeCode" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
              maxLength={6} placeholder="••••••" placeholderTextColor={c.muted} accessibilityLabel="Code from SMS" onSubmitEditing={verify} />
            <Btn title="Continue" onPress={verify} busy={busy === "verify"} disabled={code.length !== 6} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Btn title="Change number" kind="link" onPress={() => { setStep("phone"); setErr(""); }} />
              <Btn title="Send again" kind="link" onPress={send} busy={busy === "send"} />
            </View>
          </View>
        )}

        {err ? <Note kind="err">{err}</Note> : null}

        {(features.google || features.apple) && step === "phone" && (
          <View style={{ gap: 10, marginTop: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: c.line }} /><Text style={{ color: c.muted }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
            </View>
            {features.apple && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={12} style={{ height: 50 }} onPress={apple} />
            )}
            {features.google && <Btn title="Continue with Google" kind="alt" icon="logo-google" onPress={google} busy={busy === "google"} />}
          </View>
        )}

        <Text style={{ color: c.muted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
          By continuing you agree to the{" "}
          <Text style={{ color: c.brand }} onPress={() => WebBrowser.openBrowserAsync(`${WEB}/terms`)}>Terms</Text> and{" "}
          <Text style={{ color: c.brand }} onPress={() => WebBrowser.openBrowserAsync(`${WEB}/privacy`)}>Privacy policy</Text>.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
