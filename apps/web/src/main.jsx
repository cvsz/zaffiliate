import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import Dashboard, { loader as dashboardLoader } from './pages/Dashboard';
import AutopilotReview from './pages/AutopilotReview';
import Connections from './pages/Connections';
import Products from './pages/Products';
import Campaigns, { loader as campaignsLoader } from './pages/Campaigns';
import Creators from './pages/Creators';
import Links from './pages/Links';
import Content from './pages/Content';
import Publishing from './pages/Publishing';
import Outreach, { loader as outreachLoader } from './pages/Outreach';
import Workflows, { loader as workflowsLoader, action as workflowAction } from './pages/Workflows';
import Analytics, { loader as analyticsLoader } from './pages/Analytics';
import Commissions, { loader as commissionsLoader } from './pages/Commissions';
import Billing, { loader as billingLoader } from './pages/Billing';
import Audit, { loader as auditLoader } from './pages/Audit';
import Security from './pages/Security';
import Admin, { loader as adminLoader } from './pages/Admin';
import Publications, { loader as publicationsLoader } from './pages/Publications';
import Conversions, { loader as conversionsLoader } from './pages/Conversions';
import Settings, { loader as settingsLoader } from './pages/Settings';
import ErrorBoundary from './ErrorBoundary';
import Unavailable from './pages/Unavailable';
import * as api from './api';

const demo = import.meta.env.DEV;
const demoComponent = (Component) => demo ? Component : Unavailable;

const router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    ErrorBoundary,
    children: [
      { index: true, Component: Dashboard, loader: dashboardLoader },
      { path: 'overview', Component: Dashboard, loader: dashboardLoader },
      { path: 'dashboard', Component: Dashboard, loader: dashboardLoader },
      { path: 'autopilot-review', Component: AutopilotReview },
      { path: 'connections', Component: demoComponent(Connections) },
      { path: 'products', Component: demoComponent(Products) },
      { path: 'campaigns', Component: demoComponent(Campaigns), ...(demo ? { loader: campaignsLoader } : {}) },
      { path: 'creators', Component: demoComponent(Creators) },
      { path: 'links', Component: demoComponent(Links) },
      { path: 'content', Component: demoComponent(Content) },
      { path: 'publishing', Component: demoComponent(Publishing) },
      { path: 'outreach', Component: demoComponent(Outreach), ...(demo ? { loader: outreachLoader } : {}) },
      { path: 'workflows', Component: demoComponent(Workflows), ...(demo ? { loader: workflowsLoader, action: workflowAction } : {}) },
      { path: 'analytics', Component: demoComponent(Analytics), ...(demo ? { loader: analyticsLoader } : {}) },
      { path: 'commissions', Component: demoComponent(Commissions), ...(demo ? { loader: commissionsLoader } : {}) },
      { path: 'billing', Component: demoComponent(Billing), ...(demo ? { loader: billingLoader } : {}) },
      { path: 'audit', Component: demoComponent(Audit), ...(demo ? { loader: auditLoader } : {}) },
      { path: 'security', Component: demoComponent(Security) },
      { path: 'admin', Component: demoComponent(Admin), ...(demo ? { loader: adminLoader } : {}) },
      { path: 'publications', Component: demoComponent(Publications), ...(demo ? { loader: publicationsLoader } : {}) },
      { path: 'conversions', Component: demoComponent(Conversions), ...(demo ? { loader: conversionsLoader } : {}) },
      { path: 'settings', Component: demoComponent(Settings), ...(demo ? { loader: settingsLoader } : {}) }
    ]
  }
], {
  basename: import.meta.env.BASE_URL
});

export default function Root() {
  return (
    <>
      <RouterProvider router={router} />
    </>
  );
}
