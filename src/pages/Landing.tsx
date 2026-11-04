import { Link } from "react-router-dom";

// Front page for visitors who are not signed in.
export default function Landing() {
  return (
    <div className="landing">
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <img className="logo" src="/icon.svg" alt="" />
            <h1 style={{ fontSize: 21 }}>Khushi Points</h1>
          </div>
          <Link className="btn alt small" to="/login">Sign in</Link>
        </header>

        <section className="hero">
          <p className="eyebrow">For kirana, clothing, salons, bakeries and every small shop</p>
          <h2 className="hero-h">Loyalty points for your shop. No SMS, no WhatsApp spam.</h2>
          <p className="hero-p">Your customers keep points from every Khushi shop in one free app. They earn on each bill, redeem by tapping Approve in the app, and get your offers as app notifications. Nothing lands in their SMS or WhatsApp.</p>
          <div className="actions">
            <Link className="btn gold" to="/login?mode=signup">Start free</Link>
            <Link className="btn link" to="/login">I already have an account</Link>
          </div>
          <p className="hint">Free for early shops during the pilot. Works on any phone, tablet or computer. Nothing to install.</p>
        </section>

        <section className="how">
          <h3 className="section-h">How it works at the counter</h3>
          <div className="how-grid">
            <div className="panel"><span className="step-n">1</span><h4>Earn</h4><p>Scan the QR in the customer's app, or type their mobile number, and enter the bill. Points show in their app instantly.</p></div>
            <div className="panel"><span className="step-n">2</span><h4>Redeem</h4><p>Start the redemption at the counter. The customer taps Approve in their app. No OTP, no PIN.</p></div>
            <div className="panel"><span className="step-n">3</span><h4>Bring them back</h4><p>Send up to 2 offers a week as app notifications to customers who follow your shop.</p></div>
          </div>
        </section>

        <section className="how">
          <h3 className="section-h">What a small shop usually pays</h3>
          <div className="compare-grid">
            <div className="panel">
              <p className="label">Loyalty app plus WhatsApp</p>
              <p className="price">₹2,000 – ₹7,000<span> a month</span></p>
              <p className="hint">Loyalty software, a WhatsApp provider subscription, and a charge for every OTP message.</p>
            </div>
            <div className="panel accent">
              <p className="label">Khushi Points</p>
              <p className="price">Under ₹500<span> a month</span></p>
              <p className="hint">No per-message charges. Offers and redemptions go through the free Khushi Points app.</p>
            </div>
          </div>
          <p className="hint">Typical market prices from public listings, October 2026. Your costs depend on your provider.</p>
        </section>

        <section className="how">
          <h3 className="section-h">Built for real shops</h3>
          <ul className="features">
            <li><b>Fair rules, set by you.</b> Choose the % back, minimum bill, maximum discount and expiry. Only the day's highest bill earns, so split bills don't add up.</li>
            <li><b>Your staff, your control.</b> Cashiers join with a shop code. They can add bills and redeem, but can't change rules or see your reports.</li>
            <li><b>Mistakes can be undone.</b> Fix a wrong bill or redemption in two taps.</li>
            <li><b>QR code for customers.</b> Print it for the counter. Customers check their points without any app.</li>
            <li><b>Safe by design.</b> Only the customer can approve using their points, from their own phone. Each shop sees only its own customers.</li>
          </ul>
          <div className="actions"><Link className="btn gold" to="/login?mode=signup">Start free</Link></div>
        </section>

        <footer className="foot">
          <span>© {new Date().getFullYear()} Khushi Points</span>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </footer>
      </div>
    </div>
  );
}
