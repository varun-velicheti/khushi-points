import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { errorText, inr, rpc, type Pending } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useColors } from "../lib/theme";
import { Btn, Note, ShopAvatar } from "./ui";

// Shows "Approve ₹X off at Shop?" when a cashier starts a redemption.
// Checks every few seconds while the app is open, and right away when a notification arrives.
export default function ApprovalSheet() {
  const c = useColors();
  const { session, bump } = useAuth();
  const [req, setReq] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [done, setDone] = useState<{ kind: "ok" | "err" | "info"; title: string; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = useRef(true);

  const check = useCallback(async () => {
    if (!session) return;
    try {
      const list = await rpc<Pending[]>("app_pending");
      setReq((cur) => (done ? cur : list[0] ?? null));
    } catch { /* offline */ }
  }, [session, done]);

  useEffect(() => {
    if (!session) return;
    check();
    const t = setInterval(() => { if (active.current) check(); }, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => { active.current = s === "active"; if (s === "active") check(); });
    const n = Platform.OS === "web" ? null : Notifications.addNotificationReceivedListener((e) => {
      if ((e.request.content.data as { type?: string })?.type === "redeem") check();
    });
    return () => { clearInterval(t); clearInterval(tick); sub.remove(); n?.remove(); };
  }, [session, check]);

  async function decide(approve: boolean) {
    if (!req) return;
    setBusy(approve ? "approve" : "decline");
    try {
      const r = await rpc<{ ok?: boolean; error?: string; status?: string; discount?: number; balance?: number }>("app_decide", { p_request: req.request_id, p_approve: approve });
      if (r.status === "done") setDone({ kind: "ok", title: `${inr(r.discount ?? req.discount)} off at ${req.shop_name}`, text: `Approved. You have ${r.balance} points left there.` });
      else if (r.status === "declined") setDone({ kind: "info", title: "Declined", text: "No points were used." });
      else setDone({ kind: "err", title: "Not redeemed", text: errorText(r.error ?? "") });
      bump();
    } catch (e) {
      setDone({ kind: "err", title: "Not redeemed", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }
  function close() { setDone(null); setReq(null); setTimeout(check, 300); }

  const secs = req ? Math.max(0, Math.round((new Date(req.expires_at).getTime() - now) / 1000)) : 0;
  const visible = !!req && (secs > 0 || !!done);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => (done ? close() : decide(false))}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36, gap: 14 }}>
          {req && !done && <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <ShopAvatar size={48} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.muted, fontSize: 14 }}>{req.shop_name} wants to use your points</Text>
                <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800" }} accessibilityRole="header">Approve {inr(req.discount)} off?</Text>
              </View>
            </View>
            <View style={{ backgroundColor: c.sunk, borderRadius: 14, padding: 14, gap: 6 }}>
              <Row label="Bill" value={inr(req.bill_amount)} />
              <Row label="Points used" value={`${req.points} pts`} />
              <Row label="You pay" value={inr(req.bill_amount - req.discount)} strong />
            </View>
            <Text style={{ color: c.muted, fontSize: 13, textAlign: "center" }}>
              Only approve if you are at {req.shop_name}'s counter now. Expires in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}.
            </Text>
            <Btn title="Approve" kind="gold" icon="checkmark-circle" busy={busy === "approve"} disabled={!!busy} onPress={() => decide(true)} />
            <Btn title="Decline" kind="alt" busy={busy === "decline"} disabled={!!busy} onPress={() => decide(false)} />
          </>}
          {done && <>
            <Note kind={done.kind} title={done.title}>{done.text}</Note>
            <Btn title="Done" onPress={close} />
          </>}
        </View>
      </View>
    </Modal>
  );

  function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: strong ? c.ink : c.muted, fontSize: 15, fontWeight: strong ? "800" : "500" }}>{label}</Text>
        <Text style={{ color: c.ink, fontSize: 15, fontWeight: strong ? "800" : "600" }}>{value}</Text>
      </View>
    );
  }
}
