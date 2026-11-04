import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { errorText, rpc, type Activity } from "../lib/api";
import ActivityRow from "../components/ActivityRow";
import { Card, GradientHeader, HeaderButton, K, Loading, Note, Page } from "../components/ui";
import { useColors } from "../lib/theme";

export default function ActivityScreen() {
  const c = useColors();
  const [list, setList] = useState<Activity[] | null>(null);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setList(await rpc<Activity[]>("app_activity", { p_limit: 50 })); setErr(""); } catch (e) { setErr(errorText(e)); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <Page overlap={0} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      header={<GradientHeader title="Activity" left={<HeaderButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />} />}>
      <K s={13.5} c={c.muted} style={{ marginTop: 16 }}>Points you earned and used, at all your shops.</K>
      {err ? <Note kind="err">{err}</Note> : null}
      {!list && !err && <Loading />}
      {list?.length === 0 && <Card><K c={c.muted}>Nothing yet. Show your QR at a Khushi shop to start.</K></Card>}
      {list && list.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {list.map((a, i) => <ActivityRow key={i} a={a} first={i === 0} />)}
        </Card>
      )}
    </Page>
  );
}
