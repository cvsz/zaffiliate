import { createBrowserRouter, RouterProvider, ScrollRestoration } from 'react-router-dom';
import App from './App';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import Products from './pages/Products';
import Campaigns from './pages/Campaigns';
import Creators from './pages/Creators';
import Links from './pages/Links';
import Content from './pages/Content';
import Publishing from './pages/Publishing';
import Outreach from './pages/Outreach';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import Commissions from './pages/Commissions';
import Billing from './pages/Billing';
import Audit from './pages/Audit';
import Security from './pages/Security';
import Admin from './pages/Admin';
import Publications from './pages/Publications';
import Conversions from './pages/Conversions';
import Settings from './pages/Settings';
import ErrorBoundary from './ErrorBoundary';
import * as api from './api';

const tenantFromDom = () => document.getElementById('tenant')?.value || 'tenant-acme';

const router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    ErrorBoundary,
    children: [
      { index: true, Component: Dashboard },
      { path: 'overview', Component: Dashboard },
      { path: 'dashboard', Component: Dashboard },
      { path: 'connections', Component: Connections },
      { path: 'products', Component: Products },
      { path: 'campaigns', Component: Campaigns },
      { path: 'creators', Component: Creators },
      { path: 'links', Component: Links },
      { path: 'content', Component: Content },
      { path: 'publishing', Component: Publishing },
      { path: 'outreach', Component: Outreach },
      { path: 'workflows', Component: Workflows },
      { path: 'analytics', Component: Analytics },
      { path: 'commissions', Component: Commissions },
      { path: 'billing', Component: Billing },
      { path: 'audit', Component: Audit },
      { path: 'security', Component: Security },
      { path: 'admin', Component: Admin },
      { path: 'publications', Component: Publications },
      { path: 'conversions', Component: Conversions },
      { path: 'settings', Component: Settings }
    ]
  }
], {
  basename: import.meta.env.BASE_URL
});

export default function Root() {
  return (
    <>
      <RouterProvider router={router} />
      <ScrollRestoration />
    </>
  );
}
