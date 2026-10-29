import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { configured, supabase } from "./lib";
import { ShopProvider, useShop } from "./shop";
import Login from "./pages/Login";
import ShopSetup from "./pages/ShopSetup";
import Counter from "./pages/Counter";
import Customers from "./pages/Customers";
import Owner from "./pages/Owner";
import PublicBalance from "./pages/PublicBalance";
import Landing from "./pages/Landing";
import ResetPassword from "./pages/ResetPassword";
import { Privacy, Terms } from "./pages/Legal";

export default function App() {
  if (!configured) return <NotConfigured />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/b/:slug" element={<PublicBalance />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/*" element={<ShopProvider><StaffApp /></ShopProvider>} />
      </Routes>
    </BrowserRouter>
  );
}

function StaffApp() {
  const { loading, session, memberships, recovery } = useShop();
  if (loading) return <div className="wrap hint">Loading…</div>;
  if (recovery && session) return <ResetPassword />;
  if (!session) return (
    <Routes>
      <Route index element={<Landing />} />
      <Route path="login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
  if (memberships.length === 0) return <ShopSetup />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Counter />} />
        <Route path="customers" element={<Customers />} />
        <Route path="owner" element={<OwnerOnly />} />
        <Route path="add-shop" element={<ShopSetup embedded />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function OwnerOnly() {
  const { current } = useShop();
  if (current?.role !== "owner") return <Navigate to="/" replace />;
  return <Owner />;
}

function Layout() {
  const { current, memberships, selectShop } = useShop();
  if (!current) return null;
  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden="true">K</div>
          <div style={{ minWidth: 0 }}>
            <h1>Khushi Points</h1>
            <div className="shop">{current.shop.name} · {current.role === "owner" ? "Owner" : "Cashier"}</div>
          </div>
        </div>
        <div className="top-actions">
          {memberships.length > 1 && (
            <select aria-label="Shop" value={current.shop.id} onChange={(e) => selectShop(e.target.value)}>
              {memberships.map((m) => <option key={m.shop.id} value={m.shop.id}>{m.shop.name}</option>)}
            </select>
          )}
          <button className="btn alt small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <nav className="tabs" aria-label="Sections">
        <NavLink to="/" end>Counter</NavLink>
        <NavLink to="/customers">Customers</NavLink>
        {current.role === "owner" && <NavLink to="/owner">Owner</NavLink>}
      </nav>
      <Outlet key={current.shop.id} />
      <footer className="foot">
        <span>Khushi Points</span>
        <Link to="/privacy">Privacy policy</Link>
        <Link to="/terms">Terms</Link>
      </footer>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="wrap narrow">
      <div className="panel stack" style={{ marginTop: 40 }}>
        <h2>Connect Supabase</h2>
        <p className="sub">Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Supabase project URL and public anon key, then restart.</p>
      </div>
    </div>
  );
}
