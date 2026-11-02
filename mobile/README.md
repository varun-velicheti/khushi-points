# Khushi Points customer app (Android + iPhone)

One free app for shoppers: points from every Khushi shop, each shop's points usable only there,
approve redemptions with a tap, offers from shops you follow. No SMS or WhatsApp to shoppers.

Built with Expo (React Native). Same Supabase backend as the shop web app.

## Screens
- **Sign in**: mobile number + one-time code (customer-requested), or Google / Apple (switch on in `app.json` → `extra`).
- **Wallet**: points per shop, expiring soon, latest offer.
- **Shop**: points and rules, follow/unfollow, offers, address and directions, history with receipts and expired points.
- **My QR**: member QR the cashier scans.
- **Offers**: offers from followed shops (max 2 per shop per week).
- **Profile**: name, add mobile number (pulls in points saved to it), notifications, delete account.
- **Approve sheet**: pops up when a cashier starts a redemption; points are used only after Approve.

## Run locally
```bash
cd mobile
npm install
npx expo start          # scan the QR with the Expo Go app, or press w for web
```

## Build for the stores (cloud, no Mac needed)
1. Create a free account at expo.dev and run `npx eas-cli@latest init` once (adds the project ID to `app.json`).
2. Android test build (APK to share with pilot testers): `npx eas-cli@latest build -p android --profile preview`
3. Store builds: `npx eas-cli@latest build -p all --profile production`, then `npx eas-cli@latest submit`.

Notifications need the Expo project ID (step 1), a Firebase project for Android (FCM key uploaded to Expo),
and Apple push keys (EAS sets these up during the first iOS build).

## Google and Apple sign-in
1. Supabase → Authentication → Providers: enable Google (OAuth client from Google Cloud) and Apple.
2. Add `khushipoints://sign-in` to Supabase → Authentication → URL Configuration → Redirect URLs.
3. Set `extra.googleSignIn` / `extra.appleSignIn` to `true` in `app.json`.
