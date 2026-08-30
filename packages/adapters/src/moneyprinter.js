const DEFAULT_TIMEOUT_MS = 30_000;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function normalizeBaseUrl(value) {
  const parsed = new URL(required(value, 'baseUrl'));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('baseUrl must use http or https');
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeTask(payload) {
  const data = payload?.data ?? payload;
  const taskId = String(data?.task_id ?? '').trim();
  if (!taskId) throw new Error('MoneyPrinter response is missing task_id');
  return Object.freeze({ taskId, state: String(data?.state ?? 'queued'), payload: data });
}

export function createMoneyPrinterAdapter({ baseUrl, apiKey, transport = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const endpoint = normalizeBaseUrl(baseUrl);
  const secret = required(apiKey, 'apiKey');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new TypeError('timeoutMs must be between 1000 and 120000');

  async function request(path, { method = 'GET', body, requestId } = {}) {
    const response = await transport(`${endpoint}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': secret,
        'x-task-id': required(requestId, 'requestId')
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const error = new Error(`MoneyPrinter request failed (${response.status})`);
      error.name = 'MoneyPrinterProviderError';
      error.httpStatus = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return payload;
  }

  return Object.freeze({
    provider: 'moneyprinterturbo',
    async createVideo({ tenantId, subject, script = '', terms, aspect = '9:16', voiceName = 'th-TH-PremwadeeNeural-Female', idempotencyKey, approvalRef }) {
      required(tenantId, 'tenantId');
      required(approvalRef, 'approvalRef');
      const requestId = required(idempotencyKey, 'idempotencyKey');
      const payload = {
        video_subject: required(subject, 'subject'),
        video_script: String(script ?? ''),
        video_aspect: String(aspect),
        video_count: 1,
        voice_name: String(voiceName),
        subtitle_enabled: true
      };
      if (Array.isArray(terms) && terms.length) payload.video_terms = terms.map(String);
      return normalizeTask(await request('/api/v1/videos', { method: 'POST', body: payload, requestId }));
    },
    async getTask({ tenantId, taskId }) {
      const scope = required(tenantId, 'tenantId');
      const id = required(taskId, 'taskId');
      if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new TypeError('taskId has invalid format');
      return normalizeTask(await request(`/api/v1/tasks/${encodeURIComponent(id)}`, { requestId: `${scope}:${id}` }));
    }
  });
}

