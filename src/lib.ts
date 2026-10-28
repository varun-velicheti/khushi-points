import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing-key");

export type Shop = {
  id: string; name: string; slug: string; join_code: string;
  earn_pct: number; point_value: number; min_bill: number; min_redeem: number;
  max_redeem_pct: number; expiry_days: number; one_bill_per_day: boolean; plan: string;
};
export type Membership = { role: "owner" | "cashier"; shop: Shop };

// Plain-language messages for the error codes the database functions raise.
const MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: "Please sign in again.",
  NOT_A_MEMBER: "You are not staff at this shop.",
  OWNER_ONLY: "Only the shop owner can do this.",
  BAD_MOBILE: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.",
  BILL_NO_REQUIRED: "Enter the bill number. Each bill earns points once.",
  BAD_AMOUNT: "Enter the bill amount.",
  BELOW_MIN_BILL: "This bill is below the minimum amount that earns points.",
  CONSENT_REQUIRED: "Ask the customer and tick the consent box before adding a new number.",
  BILL_ALREADY_USED: "This bill number already earned points. Each bill earns once.",
  ALREADY_EARNED_TODAY: "This number already earned points today. Only one bill per number per day earns points.",
  LOWER_THAN_TODAYS_BILL: "This number already earned points today for a bigger bill. Only the highest bill each day earns points.",
  TOO_SMALL_FOR_POINTS: "This bill is too small to earn a point.",
  NO_CUSTOMER: "This number has no points at this shop yet.",
  NO_PIN: "This customer has not set a PIN yet. Use an OTP.",
  PIN_LOCKED: "PIN locked after 3 wrong tries. Verify with an OTP to unlock.",
  WRONG_PIN: "Wrong PIN.",
  PIN_FORMAT: "The PIN must be exactly 4 digits.",
  PIN_TOO_EASY: "That PIN is too easy to guess. Avoid 1234, 0000 and similar.",
  BELOW_MIN_REDEEM: "That is fewer than the minimum points needed to redeem.",
  NOT_ENOUGH_POINTS: "The customer does not have that many points.",
  OVER_MAX_DISCOUNT: "That is more than the maximum discount allowed on this bill.",
  OTP_EXPIRED: "The OTP has expired or was already used. Send a new one.",
  WRONG_OTP: "Wrong OTP.",
  OTP_TOO_MANY_TRIES: "Too many wrong codes. Send a new OTP.",
  OTP_RATE_LIMIT: "Too many OTPs for this number. Wait 15 minutes and try again.",
  SHOP_OTP_DAILY_LIMIT: "Your shop reached today's OTP limit. Contact support.",
  SMS_FAILED: "The SMS could not be sent. Check the SMS settings or try again.",
  BAD_JOIN_CODE: "That shop code is not right. Ask the owner for the 6-letter code.",
  TOO_MANY_SHOPS: "You can own up to 5 shops on one login.",
  CANNOT_REMOVE_SELF: "You cannot remove yourself.",
};

export function errorText(err: unknown): string {
  const raw = typeof err === "string" ? err : (err as { message?: string })?.message ?? String(err);
  const code = raw.match(/[A-Z][A-Z_]{3,}/)?.[0];
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (/check constraint/i.test(raw)) return "One of the values is out of range. Check the numbers.";
  if (/Failed to fetch|NetworkError/i.test(raw)) return "No internet connection. Try again.";
  return raw;
}

// Calls a database function and throws a readable error.
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorText(error.message));
  return data as T;
}

export const cleanMobile = (s: string) => {
  let m = s.replace(/\D/g, "");
  if (m.length === 12 && m.startsWith("91")) m = m.slice(2);
  return m;
};
export const validMobile = (m: string) => /^[6-9]\d{9}$/.test(m);
export const fmtMobile = (m: string) => (m.length === 10 ? m.slice(0, 5) + " " + m.slice(5) : m);
export const maskMobile = (m: string) => "XXXXXX" + m.slice(6);
export const inr = (n: number | string) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const when = (t: string) => {
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
