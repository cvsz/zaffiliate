import { Outlet, NavLink, useLocation } from 'react-router-dom';
import './index.css';

const sections = [
  ['dashboard', 'Dashboard'],
  ['campaigns', 'Campaigns'],
  ['publications', 'Publications'],
  ['conversions', 'Conversions'],
  ['connections', 'Connections'],
  ['products', 'Products & Offers'],
  ['creators', 'Creators & CRM'],
  ['links', 'Affiliate Links'],
  ['content', 'Content Studio'],
  ['publishing', 'Publishing'],
  ['outreach', 'Outreach Center'],
  ['workflows', 'Approval Center'],
  ['analytics', 'Attribution Funnel'],
  ['commissions', 'Commissions & Margin'],
  ['billing', 'Billing & Usage'],
  ['audit', 'Audit Log'],
  ['security', 'Security & Incidents'],
  ['settings', 'Settings'],
  ['admin', 'Operator Console']
];

export default function App() {
  const location = useLocation();
  const path = location.pathname.replace(/^\/+|\/+$/g, '') || 'dashboard';
  const title = sections.find(([p]) => p === path)?.[1] || 'Dashboard';

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">zaffiliate</div>
        <nav>
          {sections.map(([route, label]) => (
            <NavLink
              key={route}
              to={`/${route}`}
              end={route === 'dashboard'}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
              aria-current={location.pathname === `/${route}` ? 'page' : undefined}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header>
          <div>
            <p className="eyebrow">Affiliate Commerce Control Plane</p>
            <h1 id="title">{title}</h1>
          </div>
          <div className="status-group">
            <label className="tenant-picker" htmlFor="tenant">
              Tenant
              <select id="tenant" defaultValue="tenant-acme">
                <option value="tenant-acme">tenant-acme</option>
                <option value="tenant-northwind">tenant-northwind</option>
              </select>
            </label>
            <div className="status" id="status">API status: checking</div>
          </div>
        </header>
        <Outlet />
      </main>
      <footer className="public-footer" aria-label="Site">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="mailto:support@zeaz.dev">Contact</a>
      </footer>
    </div>
  );
}
