export const ControlPlaneSections = Object.freeze([
  { id: 'overview', label: 'Overview', path: '/' },
  { id: 'connections', label: 'Connections', path: '/connections' },
  { id: 'products', label: 'Products & Offers', path: '/products' },
  { id: 'campaigns', label: 'Campaigns', path: '/campaigns' },
  { id: 'creators', label: 'Creators & CRM', path: '/creators' },
  { id: 'links', label: 'Affiliate Links', path: '/links' },
  { id: 'content', label: 'Content Studio', path: '/content' },
  { id: 'publishing', label: 'Publishing', path: '/publishing' },
  { id: 'outreach', label: 'Outreach', path: '/outreach' },
  { id: 'workflows', label: 'Jobs & Approvals', path: '/workflows' },
  { id: 'analytics', label: 'Analytics', path: '/analytics' },
  { id: 'billing', label: 'Billing & Usage', path: '/billing' },
  { id: 'audit', label: 'Audit Log', path: '/audit' },
  { id: 'security', label: 'Security & Incidents', path: '/security' },
  { id: 'admin', label: 'Admin', path: '/admin' }
]);

export function controlPlaneManifest() {
  return Object.freeze({
    product: 'zaffiliate',
    version: 1,
    secretBoundary: 'server-only',
    sections: ControlPlaneSections
  });
}
