// Message Central Verify Now: the provider makes the code, sends it and checks it.
const env = (k: string) => Deno.env.get(k) ?? "";
const base = () => env("MESSAGECENTRAL_BASE_URL") || "https://cpaas.messagecentral.com";
let token: { value: string; at: number } | null = null;

async function auth(): Promise<string> {
  if (token && Date.now() - token.at < 10 * 60 * 1000) return token.value;
  const q = new URLSearchParams({
    customerId: env("MESSAGECENTRAL_CUSTOMER_ID"), key: btoa(env("MESSAGECENTRAL_PASSWORD")), scope: "NEW", country: "91",
  });
  const res = await fetch(`${base()}/auth/v1/authentication/token?${q}`, { headers: { accept: "*/*" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.token) throw new Error("VERIFYNOW_AUTH_FAILED " + JSON.stringify(body).slice(0, 200));
  token = { value: body.token, at: Date.now() };
  return body.token;
}

export async function vnSend(mobile: string): Promise<{ ok: boolean; ref?: string; detail?: string }> {
  const q = new URLSearchParams({
    countryCode: "91", customerId: env("MESSAGECENTRAL_CUSTOMER_ID"), flowType: "SMS", mobileNumber: mobile, otpLength: "6",
  });
  const res = await fetch(`${base()}/verification/v3/send?${q}`, { method: "POST", headers: { authToken: await auth() } });
  const body = await res.json().catch(() => ({}));
  const ref = body?.data?.verificationId;
  return ref ? { ok: true, ref: String(ref) } : { ok: false, detail: JSON.stringify(body).slice(0, 200) };
}

export async function vnCheck(mobile: string, ref: string, code: string): Promise<"valid" | "wrong" | "expired"> {
  const q = new URLSearchParams({
    countryCode: "91", mobileNumber: mobile, verificationId: ref, customerId: env("MESSAGECENTRAL_CUSTOMER_ID"), code,
  });
  const res = await fetch(`${base()}/verification/v3/validateOtp?${q}`, { headers: { authToken: await auth() } });
  const body = await res.json().catch(() => ({}));
  if (body?.data?.verificationStatus === "VERIFICATION_COMPLETED") return "valid";
  if (body?.responseCode === 705 || body?.responseCode === 800 || /EXPIRED/i.test(JSON.stringify(body))) return "expired";
  return "wrong";
}
