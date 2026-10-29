import { Link } from "react-router-dom";

// Front page for visitors who are not signed in.
export default function Landing() {
  return (
    <div className="landing">
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <div className="logo" aria-hidden="true">K</div>
            <h1 style={{ fontSize: 21 }}>Khushi Points</h1>
          </div>
          <Link className="btn alt small" to="/login">Sign in</Link>
        </header>

        <section className="hero">
          <p className="eyebrow">For kirana, clothing, salons, bakeries and every small shop</p>
          <h2 className="hero-h">Loyalty points for your shop. No WhatsApp bill.</h2>
          <p className="hero-p">Customers earn points with just their mobile number. They redeem with a one-time SMS code, then a 4-digit PIN. You stop paying a WhatsApp provider every month.</p>
          <div className="actions">
            <Link className="btn gold" to="/login?mode=signup">Start free</Link>
            <Link className="btn link" to="/login">I already have an account</Link>
          </div>
          <p className="hint">Free for early shops during the pilot. Works on any phone, tablet or computer. Nothing to install.</p>
        </section>

        <section className="how">
          <h3 className="section-h">How it works at the counter</h3>
          <div className="how-grid">
            <div className="panel"><span className="step-n">1</span><h4>Earn</h4><p>Type the customer's number and the bill. Points are added instantly. No OTP, no app for the customer.</p></div>
            <div className="panel"><span className="step-n">2</span><h4>First redemption</h4><p>One SMS code proves it's really their number. Then they set a 4-digit PIN.</p></div>
            <div className="panel"><span className="step-n">3</span><h4>Every redemption after</h4><p>The customer types their PIN. No SMS, so it costs you nothing.</p></div>
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
              <p className="hint">One SMS per customer for the first redemption, about ₹0.20. After that the PIN is free.</p>
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
            <li><b>Safe by design.</b> Cashiers never see a customer's OTP. PINs are stored scrambled. Each shop sees only its own customers.</li>
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
