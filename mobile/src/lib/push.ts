import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { rpc } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Asks once for permission and saves this phone's push token. Silent if not possible (web, simulator, not built with EAS yet).
export async function registerForPush(): Promise<"on" | "off" | "unavailable"> {
  if (Platform.OS === "web" || !Device.isDevice) return "unavailable";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("redeem", {
        name: "Approve redemptions", importance: Notifications.AndroidImportance.HIGH, sound: "default",
      });
      await Notifications.setNotificationChannelAsync("offers", {
        name: "Offers from shops you follow", importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "off";
    const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
    const projectId = extra.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "unavailable";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await rpc("app_register_push", { p_token: token, p_platform: Platform.OS });
    return "on";
  } catch {
    return "unavailable";
  }
}
