function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function normalizeCreatorContact(input) {
  if (!input || typeof input !== 'object') throw new TypeError('contact is required');
  const email = input.email == null ? null : String(input.email).trim().toLowerCase();
  const handle = input.handle == null ? null : String(input.handle).trim().toLowerCase();
  if (!email && !handle) throw new Error('email or handle is required');
  return Object.freeze({
    tenantId: required(input.tenantId, 'tenantId'),
    creatorId: required(input.creatorId, 'creatorId'),
    email,
    handle,
    platform: input.platform == null ? null : String(input.platform).trim().toLowerCase(),
    consent: Boolean(input.consent),
    suppressed: Boolean(input.suppressed)
  });
}

export function contactDedupeKey(contact) {
  const identity = contact.email ? `email:${contact.email}` : `handle:${contact.platform || 'unknown'}:${contact.handle}`;
  return `${contact.tenantId}:${identity}`;
}

export function canSendOutreach({ contact, now = new Date(), quietStartHour = 21, quietEndHour = 8, sentToday = 0, dailyBudget = 50 }) {
  if (!contact.consent) return Object.freeze({ allowed: false, reason: 'consent_required' });
  if (contact.suppressed) return Object.freeze({ allowed: false, reason: 'suppressed' });
  if (sentToday >= dailyBudget) return Object.freeze({ allowed: false, reason: 'daily_budget_exhausted' });
  const hour = now.getUTCHours();
  const quiet = quietStartHour > quietEndHour ? hour >= quietStartHour || hour < quietEndHour : hour >= quietStartHour && hour < quietEndHour;
  if (quiet) return Object.freeze({ allowed: false, reason: 'quiet_hours' });
  return Object.freeze({ allowed: true, reason: 'allowed' });
}

export function createOutboxMessage({ tenantId, messageId, contact, channel, templateVersion, subject = null, body, idempotencyKey, createdAt = new Date().toISOString() }) {
  if (!contact || contact.tenantId !== tenantId) throw new Error('contact tenant mismatch');
  const normalizedChannel = required(channel, 'channel').toLowerCase();
  if (!['email','manual_dm'].includes(normalizedChannel)) throw new Error('unsupported outreach channel');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    messageId: required(messageId, 'messageId'),
    creatorId: contact.creatorId,
    channel: normalizedChannel,
    templateVersion: required(templateVersion, 'templateVersion'),
    subject: subject == null ? null : String(subject),
    body: required(body, 'body'),
    idempotencyKey: required(idempotencyKey, 'idempotencyKey'),
    status: 'pending',
    attempts: 0,
    createdAt
  });
}

export function transitionOutboxMessage(message, nextStatus) {
  const allowed = {
    pending: ['sending','cancelled'],
    sending: ['sent','failed'],
    failed: ['pending','dead_letter'],
    sent: [],
    cancelled: [],
    dead_letter: []
  };
  const current = required(message?.status, 'status');
  const next = required(nextStatus, 'nextStatus');
  if (!allowed[current]?.includes(next)) throw new Error(`invalid outbox transition: ${current} -> ${next}`);
  return Object.freeze({ ...message, status: next, attempts: next === 'sending' ? Number(message.attempts || 0) + 1 : Number(message.attempts || 0) });
}
