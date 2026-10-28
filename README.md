# Khushi Points

Loyalty points for small shops, without paying for WhatsApp.

- **Earn:** the cashier types the customer's mobile number and the bill. No OTP. One bill per number per day earns points, and each bill number earns once.
- **First redemption:** one SMS OTP proves the customer owns the number. The customer then sets a 4-digit PIN.
- **Later redemptions:** the customer types the PIN. No SMS cost. Three wrong PINs lock it; an OTP unlocks it.
- **Customer balance page:** a QR code at the counter opens `/b/<shop>`, where customers check their points with no login.

## How it is built

| Part | Where |
|---|---|
| Database, points rules, security | `supabase/migrations/` (Postgres functions + row level security) |
| OTP sending | `supabase/functions/send-otp/` (Supabase Edge Function: demo, MSG91 or 2Factor) |
| Counter, customers, owner pages | `src/` (React + Vite) |
| Rules tests | `supabase/tests/` |

All writes go through database functions, so the rules cannot be skipped from the browser. Staff never see the OTP (except in demo mode), so a cashier cannot redeem a customer's points without the customer's phone. PINs and OTPs are stored only as bcrypt hashes.

## Setup

### 1. Supabase project
1. Create a project at [supabase.com](https://supabase.com) (region: Mumbai).
2. **Database:** open SQL Editor, paste `supabase/migrations/20261028000000_init.sql`, and run it.
   Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. **Edge function:** `npx supabase functions deploy send-otp`.
   With `SMS_PROVIDER` unset, the function runs in demo mode and shows the OTP on the counter screen.
4. **Auth:** Authentication → URL Configuration → set Site URL to where the app is hosted.

### 2. Run the app
```bash
cp .env.example .env.local     # fill in Project URL and anon key (Project Settings → API)
npm install
npm run dev
```

### 3. Host it
Any static host works (Vercel, Netlify, Cloudflare Pages): build command `npm run build`, output folder `dist`. The public Supabase URL and anon key are in `.env.production`, so no host settings are needed. Page redirects for `/b/...` links are already configured (`vercel.json`, `public/_redirects`).

### 4. Real SMS (India)
1. Register your company on a DLT portal (Jio, Vodafone Idea, Airtel, …) and get a sender ID (e.g. `KHUSHI`).
2. Register an OTP template, for example:
   `{#var#} is your OTP to redeem points at {#var#}. Valid 5 minutes. Do not share. - Khushi Points`
3. Set function secrets (Supabase → Edge Functions → Secrets):
   - MSG91: `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (template variables `otp` and `shop`)
   - 2Factor: `SMS_PROVIDER=2factor`, `TWOFACTOR_API_KEY`, `TWOFACTOR_TEMPLATE`
4. **Turn off demo mode before real customers use it.** Demo mode shows the code to the cashier.

## Tests
```bash
# needs a local Postgres; runs every points rule against a throwaway database
PGHOST=localhost PGUSER=postgres supabase/tests/run_local.sh
```
GitHub Actions runs these tests and the app build on every push.

## Limits built in
- OTP: valid 5 minutes, 3 tries, at most 3 per number per 15 minutes, 300 per shop per day.
- PIN: 4 digits, easy PINs (1234, 0000, …) refused, locks after 3 wrong tries.
- One owner login can own up to 5 shops.

## Roadmap
- Phase 2: Razorpay subscriptions and SMS packs, multiple branches, Telugu and Hindi screens, password reset page.
- Later: Android app, import from billing software, promotional SMS (paid add-on), rate limiting on the public balance page.
