const sections = [
  ['overview', 'Overview', 'Operational summary and system readiness'],
  ['connections', 'Connections', 'TikTok, Shopee, Lazada, social and messaging integrations'],
  ['products', 'Products & Offers', 'Catalog, pricing, commissions and true-margin analysis'],
  ['campaigns', 'Campaigns', 'Affiliate campaigns, budgets and lifecycle state'],
  ['creators', 'Creators & CRM', 'Creator discovery, consent, suppression and outreach'],
  ['links', 'Affiliate Links', 'Deep links, sub-ID attribution and link health'],
  ['content', 'Content Studio', 'AI scripts, images, video briefs and provenance'],
  ['publishing', 'Publishing', 'Calendar, approvals and multi-channel delivery'],
  ['outreach', 'Outreach Center', 'Consent-safe email and DM workflows'],
  ['workflows', 'Approval Center', 'Durable jobs, mutation approvals and replay protection'],
  ['analytics', 'Attribution Funnel', 'Attribution, conversions, commissions and margin'],
  ['commissions', 'Commissions & Margin', 'Commission ledgers, effective margin and payout readiness'],
  ['billing', 'Billing & Usage', 'Plans, quotas, usage and ledger reconciliation'],
  ['audit', 'Audit Log', 'Tenant/actor/action/resource event history'],
  ['security', 'Security & Incidents', 'Secrets, alerts, incidents and policy status'],
  ['admin', 'Operator Console', 'Tenant, entitlement and operator controls']
];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === undefined || child === null) continue;
    node.append(child);
  }
  return node;
}

async function api(path, tenant, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'x-tenant-id': tenant, ...(options.headers ?? {}) }
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function money(minor, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format((minor ?? 0) / 100);
}

function pct(value) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

function num(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

function cell(value) {
  return el('td', { text: value ?? '—' });
}

function table(headers, rows) {
  return el('table', { class: 'data' }, [
    el('thead', {}, [el('tr', {}, headers.map((header) => el('th', { text: header, scope: 'col' })))]),
    el('tbody', {}, rows)
  ]);
}

function kvList(entries) {
  return el('dl', { class: 'kv' }, entries.flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })]));
}

function panel(titleText, node) {
  return el('div', { class: 'panel' }, [el('h3', { text: titleText }), node]);
}

function errorNote(status, body) {
  const detail = body && body.error ? `: ${body.error}` : '';
  return el('p', { class: 'error', text: `API request failed (${status}${detail})` });
}

async function renderWorkflows(root, ctx) {
  root.append(el('h2', { text: 'Pending approvals' }));
  const feed = el('div', { class: 'feed', role: 'status', 'aria-live': 'polite' });
  const outcome = await api('/api/workflow/pending-approvals', ctx.tenant());
  if (!outcome.ok) {
    root.append(errorNote(outcome.status, outcome.body));
    return;
  }
  const approvals = Array.isArray(outcome.body.approvals) ? outcome.body.approvals : [];
  if (approvals.length === 0) {
    root.append(el('p', { class: 'empty', text: 'Queue is clear. No pending approvals.' }));
  } else {
    const rows = approvals.map((approval) => {
      const actions = el('td', {}, [
        el('button', { type: 'button', class: 'btn approve', 'data-action': 'approve', 'data-id': approval.id, text: 'Approve' }),
        ' ',
        el('button', { type: 'button', class: 'btn reject', 'data-action': 'reject', 'data-id': approval.id, text: 'Reject' })
      ]);
      return el('tr', {}, [
        cell(approval.id),
        cell(approval.kind),
        cell(approval.title),
        cell(approval.requestedBy),
        cell(money(approval.impactMinor, approval.currency)),
        el('td', {}, [el('span', { class: `badge ${approval.status}`, text: approval.status })]),
        actions
      ]);
    });
    root.append(table(['ID', 'Kind', 'Title', 'Requested by', 'Impact', 'Status', 'Actions'], rows));
  }
  root.append(el('p', { class: 'note', text: `Decisions POST to /api/workflow/approve under tenant ${ctx.tenant()}.` }));
  root.append(feed);
  root.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
    if (!button) return;
    button.disabled = true;
    const decision = await api('/api/workflow/approve', ctx.tenant(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId: button.dataset.id, decision: button.dataset.action })
    });
    if (decision.ok) {
      feed.replaceChildren(el('p', { class: 'ok', text: `${decision.body.approval.id} → ${decision.body.approval.status}` }));
      ctx.refresh();
    } else {
      button.disabled = false;
      feed.replaceChildren(el('p', { class: 'error', text: `Decision refused (${decision.status}): ${decision.body && decision.body.error ? decision.body.error : 'unknown_error'}` }));
    }
  });
}

async function renderOutreach(root, ctx) {
  root.append(el('h2', { text: 'Outreach attempts' }));
  const outcome = await api('/api/outreach/attempts', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const attempts = Array.isArray(outcome.body.attempts) ? outcome.body.attempts : [];
  const rows = attempts.map((attempt) => el('tr', {}, [
    cell(attempt.id),
    cell(attempt.channel),
    cell(attempt.creator),
    cell(attempt.template),
    cell(attempt.consentRef),
    el('td', {}, [el('span', { class: `badge ${attempt.status}`, text: attempt.status })]),
    cell(attempt.sentAt ?? 'not sent')
  ]));
  root.append(table(['ID', 'Channel', 'Creator', 'Template', 'Consent reference', 'Status', 'Sent at'], rows));
  root.append(el('p', { class: 'note', text: 'Suppression is enforced from consent references before any send.' }));
}

async function renderAnalytics(root, ctx) {
  root.append(el('h2', { text: 'Attribution funnel' }));
  const outcome = await api('/api/analytics/funnel', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const funnel = outcome.body;
  root.append(el('p', { class: 'note', text: `${funnel.window} · attribution model: ${funnel.attributionModel}` }));
  const rows = funnel.stages.map((stage) => el('tr', {}, [
    cell(stage.stage),
    cell(num(stage.events)),
    cell(pct(stage.conversionPct))
  ]));
  root.append(table(['Stage', 'Events', 'Step conversion'], rows));
  root.append(panel('Attributed totals', kvList([
    ['Orders', num(funnel.totals.orders)],
    ['GMV', money(funnel.totals.gmvMinor, funnel.currency)],
    ['Commission', money(funnel.totals.commissionMinor, funnel.currency)],
    ['Margin', pct(funnel.totals.marginPct)],
    ['Settlement reference', funnel.totals.settlementRef]
  ])));
}

async function renderCommissions(root, ctx) {
  root.append(el('h2', { text: 'Margin and payouts' }));
  const outcome = await api('/api/analytics/funnel', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const funnel = outcome.body;
  const totals = funnel.totals;
  const netMinor = totals.gmvMinor - totals.commissionMinor;
  const effectiveMargin = totals.gmvMinor === 0 ? 0 : (netMinor / totals.gmvMinor) * 100;
  root.append(panel('Period economics', kvList([
    ['Window', funnel.window],
    ['Attribution model', funnel.attributionModel],
    ['Orders', num(totals.orders)],
    ['GMV', money(totals.gmvMinor, funnel.currency)],
    ['Commission owed', money(totals.commissionMinor, funnel.currency)],
    ['Net margin', money(netMinor, funnel.currency)],
    ['Effective margin', pct(effectiveMargin)]
  ])));
  root.append(panel('Payout operations', kvList([
    ['Settlement account', totals.settlementRef],
    ['Payout batches queued', num(totals.payoutsQueued)],
    ['Policy', 'Funds release only after Approval Center sign-off']
  ])));
}

async function renderBilling(root, ctx) {
  root.append(el('h2', { text: 'Plan and usage' }));
  const outcome = await api('/api/billing/summary', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const billing = outcome.body;
  root.append(panel('Subscription', kvList([
    ['Tenant', billing.tenant],
    ['Plan', billing.plan],
    ['Period', billing.period],
    ['MRR', money(billing.mrrMinor, billing.currency)],
    ['Ledger reference', billing.ledgerRef],
    ['Invoice reference', billing.invoiceRef]
  ])));
  const rows = Object.keys(billing.quotas).map((metric) => {
    const used = billing.usage[metric] ?? 0;
    const quota = billing.quotas[metric] ?? 0;
    const utilization = quota === 0 ? 0 : (used / quota) * 100;
    return el('tr', {}, [cell(metric), cell(num(used)), cell(num(quota)), cell(pct(utilization))]);
  });
  root.append(table(['Metric', 'Used', 'Quota', 'Utilization'], rows));
}

async function renderAudit(root, ctx) {
  root.append(el('h2', { text: 'Audit trail' }));
  const outcome = await api('/api/audit', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const rows = outcome.body.rows.map((row) => el('tr', {}, [
    cell(row.at),
    cell(row.actor),
    cell(row.action),
    cell(row.resource),
    el('td', {}, [el('span', { class: `badge ${row.outcome}`, text: row.outcome })])
  ]));
  root.append(table(['At', 'Actor', 'Action', 'Resource', 'Outcome'], rows));
}

async function renderAdmin(root, ctx) {
  root.append(el('h2', { text: 'Operator console' }));
  const outcome = await api('/api/navigation', ctx.tenant());
  if (!outcome.ok) return root.append(errorNote(outcome.status, outcome.body));
  const manifest = outcome.body;
  root.append(panel('Runtime', kvList([
    ['Product', manifest.product],
    ['Manifest version', manifest.version],
    ['Secret boundary', manifest.secretBoundary],
    ['Active tenant', manifest.tenant]
  ])));
  const rows = manifest.sections.map((section) => el('tr', {}, [
    cell(section.label),
    cell(section.id),
    cell(section.path)
  ]));
  root.append(table(['Surface', 'Section id', 'Route'], rows));
  root.append(el('p', { class: 'note', text: 'Operator mutations require the x-tenant-id header and are recorded in the audit log.' }));
}

export const views = {
  workflows: { title: 'Approval Center', render: renderWorkflows },
  outreach: { title: 'Outreach Center', render: renderOutreach },
  analytics: { title: 'Attribution Funnel', render: renderAnalytics },
  commissions: { title: 'Commissions & Margin', render: renderCommissions },
  billing: { title: 'Billing & Usage', render: renderBilling },
  audit: { title: 'Audit Log', render: renderAudit },
  admin: { title: 'Operator Console', render: renderAdmin }
};

export async function renderMissionControl(root, ctx) {
  root.replaceChildren(el('p', { class: 'note', text: 'Loading mission control…' }));
  let payload;
  try {
    const response = await fetch('/api/ui/overview', { headers: { 'x-tenant-id': ctx.tenant() } });
    if (!response.ok) throw new Error(`overview_${response.status}`);
    payload = await response.json();
  } catch {
    const failure = el('div', { class: 'mc mc__empty' });
    failure.append(
      el('strong', { text: 'Mission Control could not load.' }),
      el('p', { text: 'Impact: KPIs and action items are unavailable. Retry is safe. If this persists, check API health at /healthz.' })
    );
    root.replaceChildren(failure);
    return;
  }

  const wrap = el('div', { class: 'mc' });
  const kpiTitle = el('h3', { class: 'mc__section-title', text: 'Primary KPIs' });
  const strip = el('div', { class: 'kpi-strip' });
  for (const kpi of payload.kpis.primary) {
    strip.append(kpiCard(kpi, 'primary'));
  }
  const secondaryStrip = el('div', { class: 'kpi-strip' });
  for (const kpi of payload.kpis.secondary) {
    if (kpi.value == null && kpi.valueMinorUnits == null) continue;
    secondaryStrip.append(kpiCard({ ...kpi }, 'secondary'));
  }

  const actionTitle = el('h3', { class: 'mc__section-title', text: 'Critical Action Center' });
  const actionWrap = el('div', { class: 'action-center' });
  if (payload.actionCenter.length === 0) {
    actionWrap.append(el('div', {
      class: 'mc__empty',
      text: 'No critical actions. This center surfaces publishing failures, provider outages, expiring promotions, stale commercial claims, pending approvals and kill switches the moment they need a human.'
    }));
  } else {
    for (const item of payload.actionCenter) actionWrap.append(actionItem(item));
  }

  const stamp = el('p', { class: 'note', text: `Updated ${payload.freshness.generatedAt}${payload.freshness.degraded ? ' · DEGRADED SOURCES — zero values are not confirmed zeros' : ''}` });

  wrap.append(kpiTitle, strip, el('h3', { class: 'mc__section-title', text: 'Secondary signals' }), secondaryStrip, actionTitle, actionWrap, stamp);
  root.replaceChildren(wrap);
}

function kpiCard(kpi, tier) {
  const value = kpi.valueMinorUnits != null
    ? `${kpi.valueMinorUnits.toLocaleString()} ${kpi.currency ?? ''}`.trim()
    : kpi.format === 'ratio'
      ? `${(100 * Number(kpi.value ?? 0)).toFixed(1)}%`
      : String(kpi.value ?? 0);
  return el('article', { class: `kpi kpi--${tier}` },
    [el('span', { class: 'kpi__label', text: kpi.label }), el('span', { class: 'kpi__value', text: value })]);
}

function actionItem(item) {
  const badge = el('span', { class: 'badge badge--severity', text: item.severity });
  badge.dataset.severity = item.severity;
  const row = el('article', { class: 'action-item' });
  row.dataset.severity = item.severity;
  row.append(
    badge,
    el('div', {}, [
      el('strong', { text: item.resource }),
      el('p', { text: `${item.reason} — ${item.impact}` }),
      el('p', { text: `Next: ${item.recommendedAction} · detected ${item.detectedAt}` })
    ])
  );
  return row;
}

views.overview = { render: renderMissionControl };
