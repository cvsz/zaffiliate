const sections = [
  ['overview','Overview','Operational summary and system readiness'],
  ['connections','Connections','TikTok, Shopee, Lazada, social and messaging integrations'],
  ['products','Products & Offers','Catalog, pricing, commissions and true-margin analysis'],
  ['campaigns','Campaigns','Affiliate campaigns, budgets and lifecycle state'],
  ['creators','Creators & CRM','Creator discovery, consent, suppression and outreach'],
  ['links','Affiliate Links','Deep links, sub-ID attribution and link health'],
  ['content','Content Studio','AI scripts, images, video briefs and provenance'],
  ['publishing','Publishing','Calendar, approvals and multi-channel delivery'],
  ['outreach','Outreach','Consent-safe email and DM workflows'],
  ['workflows','Jobs & Approvals','Durable jobs, mutation approvals and replay protection'],
  ['analytics','Analytics','Attribution, conversions, commissions and margin'],
  ['billing','Billing & Usage','Plans, quotas, usage and ledger reconciliation'],
  ['audit','Audit Log','Tenant/actor/action/resource event history'],
  ['security','Security & Incidents','Secrets, alerts, incidents and policy status'],
  ['admin','Admin','Tenant, entitlement and operator controls']
];

const nav = document.querySelector('#nav');
const cards = document.querySelector('#cards');
for (const [id,label,description] of sections) {
  const link = document.createElement('a');
  link.href = `#${id}`;
  link.textContent = label;
  if (id === 'overview') link.setAttribute('aria-current','page');
  nav.append(link);

  const card = document.createElement('article');
  card.className = 'card';
  const h = document.createElement('h3');
  h.textContent = label;
  const p = document.createElement('p');
  p.textContent = description;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'canonical';
  card.append(h,p,badge);
  cards.append(card);
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1) || 'overview';
  const selected = sections.find(([sectionId]) => sectionId === id) || sections[0];
  document.querySelector('#title').textContent = selected[1];
  for (const link of nav.querySelectorAll('a')) {
    if (link.getAttribute('href') === `#${selected[0]}`) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
});

fetch('/healthz', { credentials: 'same-origin' })
  .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
  .then(({ ok }) => { document.querySelector('#status').textContent = `API status: ${ok ? 'healthy' : 'unavailable'}`; })
  .catch(() => { document.querySelector('#status').textContent = 'API status: unavailable'; });
