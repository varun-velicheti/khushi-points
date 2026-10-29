import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SUPPORT_EMAIL } from "../lib";

const UPDATED = "29 October 2026";

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap narrow legal">
      <Link to="/" className="brand" style={{ marginTop: 24, textDecoration: "none", color: "inherit" }}>
        <div className="logo" aria-hidden="true">K</div>
        <h1 style={{ fontSize: 21 }}>Khushi Points</h1>
      </Link>
      <article className="panel" style={{ marginTop: 20 }}>
        <h2>{title}</h2>
        <p className="hint">Last updated {UPDATED}</p>
        {children}
      </article>
      <footer className="foot"><Link to="/">Home</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></footer>
    </div>
  );
}

const contact = SUPPORT_EMAIL
  ? <>email us at <span className="mono">{SUPPORT_EMAIL}</span></>
  : <>contact us through the shop where you collect points</>;

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <p>Khushi Points is a loyalty points service used by shops. This policy explains what we collect and why, in line with India's Digital Personal Data Protection Act, 2023.</p>

      <h3>If you collect points at a shop</h3>
      <p>The shop is responsible for your data, and Khushi Points stores it for them. We keep:</p>
      <ul>
        <li>Your mobile number, and a name if you gave one</li>
        <li>Your bills at that shop: bill number, amount, date and points</li>
        <li>Your 4-digit PIN, stored scrambled so nobody can read it</li>
      </ul>
      <p>We use this only to give and redeem your points, and to send you one-time codes (OTPs) by SMS when you redeem. We do not sell your data, share it with other shops, or send you advertising.</p>
      <p>The shop asks for your agreement before adding your number. You can ask the shop to delete your number, points and history at any time. Deleted data cannot be recovered.</p>

      <h3>If you run a shop</h3>
      <p>We keep your email address, your shop details, and the records you and your staff enter. We use them to run the service and to contact you about your account.</p>

      <h3>Who else handles the data</h3>
      <ul>
        <li>Supabase stores the data and runs sign-in.</li>
        <li>Vercel serves the app pages.</li>
        <li>An SMS provider registered with Indian telecom operators delivers OTP messages. It receives only the mobile number and the message.</li>
      </ul>

      <h3>How long we keep it</h3>
      <p>As long as the shop uses Khushi Points, or until the customer or shop asks us to delete it. Points expire on the schedule the shop sets, but the history stays until deletion.</p>

      <h3>Security</h3>
      <p>Each shop can see only its own customers. Shop staff never see OTPs. PINs and OTPs are stored scrambled. Connections are encrypted.</p>

      <h3>Questions or requests</h3>
      <p>To see, correct or delete your data, {contact}.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use">
      <p>These terms apply to shops and staff who use Khushi Points. By creating an account you agree to them.</p>

      <h3>The service</h3>
      <p>Khushi Points lets a shop give loyalty points to customers by mobile number and let them redeem points as a discount, verified by SMS code or PIN. During the pilot the service is free and features may change.</p>

      <h3>Your responsibilities as a shop</h3>
      <ul>
        <li>Ask each customer before adding their mobile number, and tick the consent box only if they agree.</li>
        <li>Enter real bills only. Keep your password private and remove staff who leave.</li>
        <li>Delete a customer's data when they ask you to.</li>
        <li>Honour points shown in the app according to the rules you set.</li>
      </ul>

      <h3>Points</h3>
      <p>Points are a discount offered by the shop, not money. They have no cash value, cannot be transferred, and expire as the shop's rules say. The shop decides the rules and is responsible for honouring them.</p>

      <h3>Availability</h3>
      <p>We work to keep the service running and your data safe, but we cannot promise it will never be interrupted. Keep your own bill records as usual.</p>

      <h3>Ending use</h3>
      <p>You can stop using the service at any time. We may suspend accounts that misuse it, for example by entering fake bills or sending unwanted messages.</p>

      <h3>Fees</h3>
      <p>The pilot is free. Before any paid plan starts, we will tell you the price and you can choose whether to continue.</p>

      <h3>Contact</h3>
      <p>For questions about these terms, {contact}.</p>
    </Page>
  );
}
