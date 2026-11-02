import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || (extra.supabaseUrl as string);
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (extra.supabaseAnonKey as string);

export const features = {
  google: process.env.EXPO_PUBLIC_GOOGLE_SIGNIN === "1" || extra.googleSignIn === true,
  apple: Platform.OS === "ios" && (process.env.EXPO_PUBLIC_APPLE_SIGNIN === "1" || extra.appleSignIn === true),
};

export const supabase = createClient(url, key, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
    flowType: "pkce",
  },
});
