const API_BASE = '/api';

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export function getOverview() {
  return api('/ui/overview');
}

export function getRevenueTrend() {
  return api('/ui/revenue-trend');
}

export function getIntegrationHealth() {
  return api('/ui/integration-health');
}

export function getWorkerHealth() {
  return api('/ui/worker-health');
}

export function getNavigation() {
  return api('/navigation');
}

export function getAudit() {
  return api('/audit');
}

export function getBillingSummary() {
  return api('/billing/summary');
}

export function getPendingApprovals() {
  return api('/workflow/pending-approvals');
}

export function getOutreachAttempts() {
  return api('/outreach/attempts');
}

export function getAnalyticsFunnel() {
  return api('/analytics/funnel');
}

export function getCreatorOverview() {
  return api('/creator-studio/overview');
}

export function getAiStudioOverview() {
  return api('/ai-studio/overview');
}

export async function approveWorkflow(approvalId, decision) {
  return api('/workflow/approve', {
    method: 'POST',
    body: JSON.stringify({ approvalId, decision })
  });
}
