import { supabase } from "./supabase";

export type WalletShop = {
  shop_id: string; name: string; category: string | null; area: string | null; city: string | null;
  points: number; value: number; expiring_30d: number; last_visit: string | null; following: boolean;
  latest_offer: string | null; latest_offer_at: string | null; logo_path: string | null;
};
export type Me = { name: string | null; phone: string | null; member_code: string; email: string | null; reminders: boolean };
export type Activity = { shop_id: string; shop_name: string; kind: "earn" | "redeem"; points: number; amount: number; at: string; logo_path?: string | null };
export type HistoryItem = { kind: "earn" | "redeem" | "expired"; points: number; amount: number | null; bill_no: string | null; note: string | null; at: string; undone: boolean };
export type Offer = { id: number; title: string; body: string; valid_until: string | null; created_at: string };
export type ShopDetail = {
  shop: { id: string; name: string; category: string | null; about: string | null; address: string | null; area: string | null;
    city: string | null; contact_phone: string | null; hours: string | null; lat: number | null; lng: number | null;
    earn_pct: number; point_value: number; min_redeem: number; max_redeem_pct: number; expiry_days: number; logo_path?: string | null };
  following: boolean; points: number; value: number;
  expiring: { points: number; expires_at: string }[]; history: HistoryItem[]; offers: Offer[];
};
export type FeedOffer = { offer_id: number; shop_id: string; shop_name: string; title: string; body: string; valid_until: string | null; created_at: string; logo_path?: string | null };
export type Pending = { request_id: string; shop_id: string; shop_name: string; points: number; discount: number; bill_amount: number; expires_at: string; logo_path?: string | null };

const MESSAGES: Record<string, string> = {
  BAD_MOBILE: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.",
  WRONG_OTP: "That code is not right. Check the SMS and try again.",
  OTP_EXPIRED: "The code expired. Ask for a new one.",
  OTP_TOO_MANY_TRIES: "Too many wrong codes. Ask for a new one.",
  OTP_RATE_LIMIT: "Too many codes asked for this number. Wait 15 minutes and try again.",
  SMS_FAILED: "We could not send the code. Check the number and try again.",
  SIGNIN_FAILED: "Sign-in did not work. Try again.",
  PHONE_IN_USE: "This number is already linked to another Khushi Points account.",
  REQUEST_EXPIRED: "This request expired. Ask the cashier to send it again.",
  REQUEST_CANCELLED: "The cashier cancelled this request.",
  REQUEST_DONE: "Already approved.",
  REQUEST_DECLINED: "You already declined this.",
  NOT_ENOUGH_POINTS: "You do not have enough points for this.",
  OVER_MAX_DISCOUNT: "That is more than this shop allows on one bill.",
};
export function errorText(e: unknown): string {
  const raw = typeof e === "string" ? e : (e as { message?: string })?.message ?? String(e);
  const code = raw.match(/[A-Z][A-Z_]{3,}/)?.[0];
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (/Network request failed|Failed to fetch/i.test(raw)) return "No internet connection. Try again.";
  return raw;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorText(error.message));
  return data as T;
}
export async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(errorText(error.message));
  if (data?.error && data?.ok === undefined) throw new Error(errorText(data.error));
  return data as T;
}

// Public web address of a shop's logo picture (set by the owner on the shop website).
export const logoUrl = (path?: string | null) => (path ? supabase.storage.from("shop-logos").getPublicUrl(path).data.publicUrl : null);

export const inr = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const shortDate = (t: string) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const when = (t: string) => {
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString()) return "Today, " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};
