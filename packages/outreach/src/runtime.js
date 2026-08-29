export const OUTREACH_CONSENT_STATES = Object.freeze(['granted', 'revoked']);

export const OUTREACH_ATTEMPT_STATES = Object.freeze(['queued', 'sending', 'sent', 'failed', 'dead_letter', 'skipped_suppressed', 'skipped_quiet_hours', 'skipped_budget', 'skipped_guardrail']);

const TERMINAL_STATES = Object.freeze(['sent', 'dead_letter', 'skipped_suppressed', 'skipped_quiet_hours', 'skipped_budget', 'skipped_guardrail']);

const TRANSITIONS = Object.freeze({
  queued: Object.freeze(['sending', 'failed', 'dead_letter', 'skipped_suppressed', 'skipped_quiet_hours', 'skipped_budget', 'skipped_guardrail']),
  sending: Object.freeze(['sent', 'failed']),
  failed: Object.freeze(['queued', 'dead_letter']),
  sent: Object.freeze([]),
  dead_letter: Object.freeze([]),
  skipped_suppressed: Object.freeze([]),
  skipped_quiet_hours: Object.freeze([]),
  skipped_budget: Object.freeze([]),
  skipped_guardrail: Object.freeze([])
});

const ATTRIBUTION_FIELDS = Object.freeze({ delivery: 'deliveredAt', reply: 'repliedAt', conversion: 'convertedAt' });

const HOUR_MS = 3600000;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function requireInteger(value, name, { min = 0, max = 23 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function toMs(value, name) {
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new TypeError(`${name} is not a valid date`);
    return time;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new TypeError(`${name} is not a valid date`);
    return parsed;
  }
  throw new TypeError(`${name} must be a Date, epoch ms number or ISO string`);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function utcDay(ms) {
  return iso(ms).slice(0, 10);
}

function isQuietHour(ms, [startHour, endHour]) {
  const hour = new Date(ms).getUTCHours();
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

function byCreationOrder(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
}

export function createOutreachRuntime({ clock = () => Date.now(), maxAttempts = 3, dailyBudgetPerChannel = 200, quietHoursUtc = [0, 7], hourlySendCapPerContact = 3, dedupeRetentionMs = 24 * HOUR_MS, transport = null } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be an integer >= 1');
  if (!Number.isInteger(dailyBudgetPerChannel) || dailyBudgetPerChannel < 0) throw new TypeError('dailyBudgetPerChannel must be an integer >= 0');
  if (!Number.isInteger(hourlySendCapPerContact) || hourlySendCapPerContact < 1) throw new TypeError('hourlySendCapPerContact must be an integer >= 1');
  if (!Number.isInteger(dedupeRetentionMs) || dedupeRetentionMs <= 0) throw new TypeError('dedupeRetentionMs must be a positive integer');
  if (transport !== null && typeof transport !== 'function') throw new TypeError('transport must be a function');
  if (!Array.isArray(quietHoursUtc) || quietHoursUtc.length !== 2) throw new TypeError('quietHoursUtc must be [startHour, endHour]');
  const [quietStart, quietEnd] = quietHoursUtc;
  requireInteger(quietStart, 'quietHoursUtc[0]');
  requireInteger(quietEnd, 'quietHoursUtc[1]');
  if (quietStart === quietEnd) throw new TypeError('quietHoursUtc start and end must differ');

  const tenants = new Map();
  const channelBudget = new Map();
  const sendLog = new Map();
  let sequence = 0;
  let attemptCounter = 0;
  let followUpCounter = 0;

  function tenantFor(tenantId) {
    const id = required(tenantId, 'tenantId');
    let tenant = tenants.get(id);
    if (!tenant) {
      tenant = { tenantId: id, contacts: new Map(), attempts: new Map(), dedupe: new Map(), followUps: new Map(), events: [] };
      tenants.set(id, tenant);
    }
    return tenant;
  }

  function existingTenant(tenantId) {
    const id = required(tenantId, 'tenantId');
    const tenant = tenants.get(id);
    if (!tenant) throw new Error(`tenant not found: ${id}`);
    return tenant;
  }

  function emit(tenant, atMs, type, payload) {
    const event = Object.freeze({ sequence: ++sequence, type, tenantId: tenant.tenantId, at: iso(atMs), ...payload });
    tenant.events.push(event);
    return event;
  }

  function transitionAttempt(tenant, attempt, next, atMs, patch = {}) {
    if (!TRANSITIONS[attempt.state]?.includes(next)) throw new Error(`invalid attempt transition: ${attempt.state} -> ${next}`);
    const settled = TERMINAL_STATES.includes(next);
    const updated = Object.freeze({
      ...attempt,
      ...patch,
      state: next,
      settledAt: settled ? iso(atMs) : attempt.settledAt,
      updatedAt: iso(atMs)
    });
    tenant.attempts.set(updated.attemptId, updated);
    emit(tenant, atMs, `outreach.attempt.${next}`, {
      attemptId: updated.attemptId,
      contactId: updated.contactId,
      channel: updated.channel,
      templateId: updated.templateId,
      templateVersion: updated.templateVersion,
      campaignRef: updated.campaignRef,
      attempts: updated.attempts,
      ...patch
    });
    return updated;
  }

  function normalizeChannels(input) {
    if (input == null) return [];
    if (!Array.isArray(input)) throw new TypeError('channels must be an array');
    const byChannel = new Map();
    for (const entry of input) {
      const record = requireObject(entry, 'channel entry');
      const channel = required(record.channel, 'channel').toLowerCase();
      const address = required(record.address, 'address');
      byChannel.set(channel, address);
    }
    return [...byChannel.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([channel, address]) => Object.freeze({ channel, address }));
  }

  function upsertContact(tenantId, contact) {
    const tenant = tenantFor(tenantId);
    const input = requireObject(contact, 'contact');
    const contactId = required(input.contactId, 'contactId');
    const email = input.email == null ? null : String(input.email).trim().toLowerCase();
    const handle = input.handle == null ? null : String(input.handle).trim().toLowerCase();
    if (!email && !handle) throw new Error('email or handle is required');
    const consentState = required(input.consentState, 'consentState');
    if (!OUTREACH_CONSENT_STATES.includes(consentState)) throw new Error(`unsupported consentState: ${consentState}`);
    const channels = Object.freeze(normalizeChannels(input.channels));
    const previous = tenant.contacts.get(contactId);
    const nowIso = iso(clock());
    const record = Object.freeze({
      tenantId: tenant.tenantId,
      contactId,
      email,
      handle,
      channels,
      consentState,
      suppressed: previous ? previous.suppressed : false,
      suppressedReason: previous ? previous.suppressedReason : null,
      suppressedAt: previous ? previous.suppressedAt : null,
      createdAt: previous ? previous.createdAt : nowIso,
      updatedAt: nowIso
    });
    tenant.contacts.set(contactId, record);
    return record;
  }

  function suppress(tenantId, contactId, { reason } = {}) {
    const tenant = existingTenant(tenantId);
    const id = required(contactId, 'contactId');
    const contact = tenant.contacts.get(id);
    if (!contact) throw new Error(`contact not found: ${id}`);
    if (contact.suppressed) return contact;
    const reasonText = required(reason, 'reason');
    const nowIso = iso(clock());
    const updated = Object.freeze({ ...contact, suppressed: true, suppressedReason: reasonText, suppressedAt: nowIso, updatedAt: nowIso });
    tenant.contacts.set(id, updated);
    return updated;
  }

  function setConsent(tenantId, contactId, consentState) {
    const tenant = existingTenant(tenantId);
    const id = required(contactId, 'contactId');
    const contact = tenant.contacts.get(id);
    if (!contact) throw new Error(`contact not found: ${id}`);
    const nowIso = iso(clock());
    const updated = Object.freeze({ ...contact, consentState, updatedAt: nowIso });
    tenant.contacts.set(id, updated);
    return updated;
  }

  function grantConsent(tenantId, contactId) {
    return setConsent(tenantId, contactId, 'granted');
  }

  function revokeConsent(tenantId, contactId) {
    return setConsent(tenantId, contactId, 'revoked');
  }

  function pruneDedupe(tenant, nowMs) {
    for (const [key, attemptId] of tenant.dedupe) {
      const attempt = tenant.attempts.get(attemptId);
      if (!attempt || nowMs - Date.parse(attempt.createdAt) > dedupeRetentionMs) tenant.dedupe.delete(key);
    }
  }

  function enqueueInternal(tenant, spec, nowMs) {
    const input = requireObject(spec, 'message spec');
    const contactId = required(input.contactId, 'contactId');
    const contact = tenant.contacts.get(contactId);
    if (!contact) throw new Error(`contact not found: ${contactId}`);
    const templateId = required(input.templateId, 'templateId');
    const templateVersion = required(input.templateVersion, 'templateVersion');
    const channel = required(input.channel, 'channel').toLowerCase();
    const registered = contact.channels.find(entry => entry.channel === channel);
    if (!registered) throw new Error(`channel not registered for contact: ${channel}`);
    const campaignRef = input.campaignRef == null ? null : required(input.campaignRef, 'campaignRef');
    const variables = input.variables == null ? {} : requireObject(input.variables, 'variables');
    const scheduledFor = input.scheduledFor == null ? null : iso(toMs(input.scheduledFor, 'scheduledFor'));
    const followUpOf = input.followUpOf == null ? null : required(input.followUpOf, 'followUpOf');
    const dedupeKey = [tenant.tenantId, templateId, templateVersion, contactId, channel, campaignRef ?? ''].join('|');
    pruneDedupe(tenant, nowMs);
    const existingId = tenant.dedupe.get(dedupeKey);
    if (existingId) return tenant.attempts.get(existingId);
    const attemptId = `att-${++attemptCounter}`;
    const attempt = Object.freeze({
      attemptId,
      tenantId: tenant.tenantId,
      contactId,
      channel,
      address: registered.address,
      templateId,
      templateVersion,
      variables: Object.freeze({ ...variables }),
      campaignRef,
      scheduledFor,
      dedupeKey,
      followUpOf,
      state: 'queued',
      attempts: 0,
      externalId: null,
      failureReason: null,
      reason: null,
      createdAt: iso(nowMs),
      updatedAt: iso(nowMs),
      sentAt: null,
      settledAt: null,
      deliveredAt: null,
      repliedAt: null,
      convertedAt: null
    });
    tenant.attempts.set(attemptId, attempt);
    tenant.dedupe.set(dedupeKey, attemptId);
    emit(tenant, nowMs, 'outreach.attempt.queued', { attemptId, contactId, channel, templateId, templateVersion, campaignRef, attempts: 0 });
    return attempt;
  }

  function enqueueMessage(tenantId, spec) {
    return enqueueInternal(tenantFor(tenantId), spec, clock());
  }

  function scheduleFollowUp(tenantId, spec) {
    const tenant = tenantFor(tenantId);
    const input = requireObject(spec, 'follow-up spec');
    const parentAttemptId = required(input.parentAttemptId, 'parentAttemptId');
    const parent = tenant.attempts.get(parentAttemptId);
    if (!parent) throw new Error(`attempt not found: ${parentAttemptId}`);
    const templateId = required(input.templateId, 'templateId');
    const templateVersion = input.templateVersion == null ? parent.templateVersion : required(input.templateVersion, 'templateVersion');
    const channel = input.channel == null ? parent.channel : required(input.channel, 'channel').toLowerCase();
    const campaignRef = input.campaignRef == null ? parent.campaignRef : required(input.campaignRef, 'campaignRef');
    const variablesSource = input.variables == null ? parent.variables : requireObject(input.variables, 'variables');
    const delayHours = input.delayHours;
    if (typeof delayHours !== 'number' || !Number.isFinite(delayHours) || delayHours <= 0) throw new TypeError('delayHours must be a positive finite number');
    const condition = input.condition == null ? 'no_reply' : required(input.condition, 'condition');
    if (condition !== 'no_reply') throw new Error(`unsupported follow-up condition: ${condition}`);
    const followUpId = `fup-${++followUpCounter}`;
    const record = Object.freeze({
      followUpId,
      tenantId: tenant.tenantId,
      parentAttemptId,
      templateId,
      templateVersion,
      channel,
      campaignRef,
      variables: Object.freeze({ ...variablesSource }),
      condition,
      delayHours,
      state: 'contingent',
      materializedAttemptId: null,
      createdAt: iso(clock()),
      updatedAt: iso(clock())
    });
    tenant.followUps.set(followUpId, record);
    return record;
  }

  function materializeFollowUps(tenant, nowMs, counts) {
    for (const followUp of tenant.followUps.values()) {
      if (followUp.state !== 'contingent') continue;
      const parent = tenant.attempts.get(followUp.parentAttemptId);
      if (!parent || !TERMINAL_STATES.includes(parent.state)) continue;
      if (followUp.condition === 'no_reply' && parent.repliedAt != null) {
        tenant.followUps.set(followUp.followUpId, Object.freeze({ ...followUp, state: 'not_met', updatedAt: iso(nowMs) }));
        continue;
      }
      const baseMs = Date.parse(parent.settledAt ?? parent.createdAt);
      if (nowMs < baseMs + followUp.delayHours * HOUR_MS) continue;
      let attemptId = null;
      try {
        const attempt = enqueueInternal(tenant, {
          contactId: parent.contactId,
          templateId: followUp.templateId,
          templateVersion: followUp.templateVersion,
          channel: followUp.channel,
          campaignRef: followUp.campaignRef,
          variables: followUp.variables,
          scheduledFor: null,
          followUpOf: followUp.followUpId
        }, nowMs);
        attemptId = attempt.attemptId;
      } catch {
        tenant.followUps.set(followUp.followUpId, Object.freeze({ ...followUp, state: 'cancelled', updatedAt: iso(nowMs) }));
        continue;
      }
      tenant.followUps.set(followUp.followUpId, Object.freeze({ ...followUp, state: 'materialized', materializedAttemptId: attemptId, updatedAt: iso(nowMs) }));
      counts.materializedFollowUps += 1;
    }
  }

  function processQueue({ now, channelId, transport: passTransport } = {}) {
    const transportFn = passTransport ?? transport;
    if (typeof transportFn !== 'function') throw new TypeError('transport is required');
    const nowMs = now == null ? clock() : toMs(now, 'now');
    const channelFilter = channelId == null ? null : required(channelId, 'channelId').toLowerCase();
    const counts = { considered: 0, sent: 0, failed: 0, retried: 0, deadLettered: 0, skippedSuppressed: 0, skippedQuietHours: 0, skippedBudget: 0, skippedGuardrail: 0, materializedFollowUps: 0 };
    for (const tenant of tenants.values()) {
      materializeFollowUps(tenant, nowMs, counts);
      const due = [...tenant.attempts.values()]
        .filter(attempt => attempt.state === 'queued')
        .filter(attempt => channelFilter == null || attempt.channel === channelFilter)
        .filter(attempt => attempt.scheduledFor == null || Date.parse(attempt.scheduledFor) <= nowMs)
        .sort(byCreationOrder);
      for (const queued of due) {
        counts.considered += 1;
        const contact = tenant.contacts.get(queued.contactId);
        if (!contact || contact.suppressed) {
          transitionAttempt(tenant, queued, 'skipped_suppressed', nowMs, { reason: contact ? 'suppressed' : 'contact_missing' });
          counts.skippedSuppressed += 1;
          continue;
        }
        if (contact.consentState !== 'granted') {
          transitionAttempt(tenant, queued, 'skipped_suppressed', nowMs, { reason: 'consent_revoked' });
          counts.skippedSuppressed += 1;
          continue;
        }
        if (isQuietHour(nowMs, quietHoursUtc)) {
          emit(tenant, nowMs, 'outreach.attempt.skipped_quiet_hours', { attemptId: queued.attemptId, contactId: queued.contactId, channel: queued.channel, templateId: queued.templateId, templateVersion: queued.templateVersion, campaignRef: queued.campaignRef, attempts: queued.attempts, reason: 'quiet_hours' });
          counts.skippedQuietHours += 1;
          continue;
        }
        const budgetKey = `${tenant.tenantId}|${queued.channel}|${utcDay(nowMs)}`;
        const used = channelBudget.get(budgetKey) ?? 0;
        if (used >= dailyBudgetPerChannel) {
          transitionAttempt(tenant, queued, 'skipped_budget', nowMs, { reason: 'daily_budget_exhausted' });
          counts.skippedBudget += 1;
          continue;
        }
        const guardKey = `${tenant.tenantId}|${queued.contactId}`;
        const recentSends = (sendLog.get(guardKey) ?? []).filter(sentAtMs => sentAtMs > nowMs - HOUR_MS);
        if (recentSends.length >= hourlySendCapPerContact) {
          transitionAttempt(tenant, queued, 'skipped_guardrail', nowMs, { reason: 'hourly_cap_reached' });
          counts.skippedGuardrail += 1;
          continue;
        }
        sendLog.set(guardKey, [...recentSends, nowMs]);
        channelBudget.set(budgetKey, used + 1);
        let current = transitionAttempt(tenant, queued, 'sending', nowMs, { attempts: queued.attempts + 1 });
        const message = Object.freeze({
          tenantId: current.tenantId,
          attemptId: current.attemptId,
          contactId: current.contactId,
          channel: current.channel,
          address: current.address,
          templateId: current.templateId,
          templateVersion: current.templateVersion,
          variables: current.variables,
          campaignRef: current.campaignRef,
          followUpOf: current.followUpOf
        });
        let result = null;
        let transportError = null;
        try {
          result = transportFn(message);
        } catch (error) {
          transportError = error?.message != null ? String(error.message) : 'transport threw';
        }
        const ok = Boolean(result) && typeof result === 'object' && result.ok === true;
        if (ok) {
          transitionAttempt(tenant, current, 'sent', nowMs, {
            sentAt: iso(nowMs),
            externalId: result.externalId == null ? null : String(result.externalId)
          });
          counts.sent += 1;
        } else {
          counts.failed += 1;
          const reason = transportError ?? (result && typeof result.error === 'string' && result.error.trim() ? result.error : 'transport_rejected');
          const failedAttempt = transitionAttempt(tenant, current, 'failed', nowMs, { failureReason: reason });
          if (current.attempts >= maxAttempts) {
            transitionAttempt(tenant, failedAttempt, 'dead_letter', nowMs, {});
            counts.deadLettered += 1;
          } else {
            transitionAttempt(tenant, failedAttempt, 'queued', nowMs, {});
            counts.retried += 1;
          }
        }
      }
    }
    return Object.freeze({ ...counts, now: iso(nowMs), channelId: channelFilter });
  }

  function recordAttribution(kind, tenantId, attemptId, details) {
    const field = ATTRIBUTION_FIELDS[kind];
    const tenant = existingTenant(tenantId);
    const id = required(attemptId, 'attemptId');
    const attempt = tenant.attempts.get(id);
    if (!attempt) throw new Error(`attempt not found: ${id}`);
    if (attempt.state !== 'sent') throw new Error(`cannot record ${kind} for attempt in state ${attempt.state}`);
    const input = details == null ? {} : requireObject(details, 'details');
    if (attempt[field] != null) return attempt;
    const atMs = input.at == null ? clock() : toMs(input.at, 'at');
    const patch = { [field]: iso(atMs), updatedAt: iso(atMs) };
    if (kind === 'delivery' && input.externalId != null && attempt.externalId == null) patch.externalId = String(input.externalId);
    const updated = Object.freeze({ ...attempt, ...patch });
    tenant.attempts.set(attempt.attemptId, updated);
    return updated;
  }

  function getContact(tenantId, contactId) {
    const tenant = existingTenant(tenantId);
    const id = required(contactId, 'contactId');
    const contact = tenant.contacts.get(id);
    if (!contact) throw new Error(`contact not found: ${id}`);
    return contact;
  }

  function getAttempt(tenantId, attemptId) {
    const tenant = existingTenant(tenantId);
    const id = required(attemptId, 'attemptId');
    const attempt = tenant.attempts.get(id);
    if (!attempt) throw new Error(`attempt not found: ${id}`);
    return attempt;
  }

  function listAttempts(tenantId) {
    return Object.freeze([...existingTenant(tenantId).attempts.values()].sort(byCreationOrder));
  }

  function listEvents(tenantId) {
    return Object.freeze([...existingTenant(tenantId).events]);
  }

  function listFollowUps(tenantId) {
    return Object.freeze([...existingTenant(tenantId).followUps.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)));
  }

  return Object.freeze({
    upsertContact,
    suppress,
    grantConsent,
    revokeConsent,
    enqueueMessage,
    processQueue,
    scheduleFollowUp,
    recordDelivery: (tenantId, attemptId, details) => recordAttribution('delivery', tenantId, attemptId, details),
    recordReply: (tenantId, attemptId, details) => recordAttribution('reply', tenantId, attemptId, details),
    recordConversion: (tenantId, attemptId, details) => recordAttribution('conversion', tenantId, attemptId, details),
    getContact,
    getAttempt,
    listAttempts,
    listEvents,
    listFollowUps
  });
}
