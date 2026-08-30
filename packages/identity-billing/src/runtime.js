import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const API_KEY_KDF_ITERATIONS = 600_000;
const API_KEY_KDF_BYTES = 32;
const API_KEY_KDF_DIGEST = 'sha256';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function requireAmountMinorUnits(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer amount in minor units`);
  return value;
}

function toTimestamp(value, name) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error(`${name} is not a valid timestamp`);
  return ms;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function normalizedList(values, name) {
  if (!Array.isArray(values)) throw new Error(`${name} must be an array`);
  const normalized = [...new Set(values.map((value) => required(value, `${name} entry`).toLowerCase()))].sort();
  if (!normalized.length) throw new Error(`at least one ${name} entry is required`);
  return normalized;
}

function deriveSecret(value, salt = randomBytes(16), iterations = API_KEY_KDF_ITERATIONS) {
  const secret = required(value, 'secret');
  const derived = pbkdf2Sync(secret, salt, iterations, API_KEY_KDF_BYTES, API_KEY_KDF_DIGEST);
  return `pbkdf2_${API_KEY_KDF_DIGEST}$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyDerivedSecret(value, encoded) {
  const parts = String(encoded ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== `pbkdf2_${API_KEY_KDF_DIGEST}`) return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < API_KEY_KDF_ITERATIONS) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'base64url');
    expected = Buffer.from(parts[3], 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== API_KEY_KDF_BYTES) return false;
  const actual = pbkdf2Sync(String(value ?? ''), salt, iterations, expected.length, API_KEY_KDF_DIGEST);
  return timingSafeEqual(actual, expected);
}

function opaqueToken(prefix) {
  return prefix + randomBytes(24).toString('base64url');
}

export function createIdentityBillingRuntime({ clock = () => Date.now() } = {}) {
  if (typeof clock !== 'function') throw new Error('clock must be a function');

  const tenants = new Map();
  const plans = new Map();
  const userIndex = new Map();
  const sessionIndex = new Map();
  const apiKeyIndex = new Map();
  const apiKeySelectorIndex = new Map();
  const invoiceIndex = new Map();
  const escalationLog = [];

  const nowMs = () => {
    const value = clock();
    if (!Number.isFinite(value)) throw new Error('clock must return a finite epoch milliseconds value');
    return value;
  };

  function tenantState(tenantId) {
    const id = required(tenantId, 'tenantId');
    let state = tenants.get(id);
    if (!state) {
      state = {
        id,
        usersBySubject: new Map(),
        sessionsByToken: new Map(),
        externalIdentitiesByKey: new Map(),
        serviceIdentities: new Map(),
        apiKeysById: new Map(),
        apiKeysByHash: new Map(),
        entitlements: [],
        usageEvents: [],
        usageTotalsByMetric: new Map(),
        ledgerEntries: [],
        ledgerSequence: 0,
        invoicesById: new Map(),
        bootstrapGrant: null,
        bootstrapDisabled: false
      };
      tenants.set(id, state);
    }
    return state;
  }

  function escalate(tenantId, actorId, action, target) {
    escalationLog.push(Object.freeze({
      at: toIso(nowMs()),
      tenantId: String(tenantId ?? ''),
      actorId: String(actorId ?? 'system'),
      action: required(action, 'action'),
      target: required(target, 'target')
    }));
  }

  function currentPlan(state) {
    const latest = state.entitlements[state.entitlements.length - 1];
    return latest ? plans.get(latest.planId) : null;
  }

  function createUser({ tenantId, subject, claims = {} } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const normalizedSubject = required(subject, 'subject');
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('claims must be an object');
    if (Object.keys(claims).some((key) => key.toLowerCase() === 'password')) throw new Error('password storage is not supported');
    if (state.usersBySubject.has(normalizedSubject)) throw new Error('subject already registered');
    const user = {
      userId: `usr_${randomUUID()}`,
      tenantId: id,
      subject: normalizedSubject,
      claims: Object.freeze({ ...claims }),
      createdAt: toIso(nowMs())
    };
    state.usersBySubject.set(normalizedSubject, user);
    userIndex.set(user.userId, { tenantId: id, user });
    escalate(id, 'system', 'user.create', user.userId);
    return Object.freeze({ ...user });
  }

  function startSession(userId, { ttlMinutes } = {}) {
    const found = userIndex.get(required(userId, 'userId'));
    if (!found) throw new Error('user not found');
    const ttlMs = requirePositiveInteger(ttlMinutes, 'ttlMinutes') * 60000;
    const state = tenantState(found.tenantId);
    const issued = nowMs();
    const token = opaqueToken('zs_');
    const session = {
      token,
      userId: found.user.userId,
      tenantId: found.tenantId,
      issuedAt: toIso(issued),
      expiresAt: toIso(issued + ttlMs),
      revokedAt: null
    };
    state.sessionsByToken.set(token, session);
    sessionIndex.set(token, state);
    return Object.freeze({ token, userId: session.userId, tenantId: session.tenantId, issuedAt: session.issuedAt, expiresAt: session.expiresAt });
  }

  function verifySession(token) {
    const value = String(token ?? '');
    if (!value) return Object.freeze({ valid: false, reason: 'session_not_found', session: null });
    const state = sessionIndex.get(value);
    const session = state ? state.sessionsByToken.get(value) : null;
    if (!session) return Object.freeze({ valid: false, reason: 'session_not_found', session: null });
    if (session.revokedAt) return Object.freeze({ valid: false, reason: 'session_revoked', session: null });
    if (nowMs() >= toTimestamp(session.expiresAt, 'expiresAt')) return Object.freeze({ valid: false, reason: 'session_expired', session: null });
    return Object.freeze({
      valid: true,
      reason: 'session_valid',
      session: Object.freeze({ userId: session.userId, tenantId: session.tenantId, issuedAt: session.issuedAt, expiresAt: session.expiresAt })
    });
  }

  function revokeSession(token) {
    const value = required(token, 'token');
    const state = sessionIndex.get(value);
    const session = state ? state.sessionsByToken.get(value) : null;
    if (!session) throw new Error('session not found');
    if (!session.revokedAt) session.revokedAt = toIso(nowMs());
    return Object.freeze({ revoked: true, userId: session.userId, tenantId: session.tenantId, revokedAt: session.revokedAt });
  }

  function linkExternalIdentity({ userId, issuer, issuerSubject } = {}) {
    const found = userIndex.get(required(userId, 'userId'));
    if (!found) throw new Error('user not found');
    const normalizedIssuer = required(issuer, 'issuer');
    const normalizedSubject = required(issuerSubject, 'issuerSubject');
    const key = `${normalizedIssuer}::${normalizedSubject}`;
    const state = tenantState(found.tenantId);
    if (state.externalIdentitiesByKey.has(key)) throw new Error('external identity already linked');
    const identity = {
      userId: found.user.userId,
      tenantId: found.tenantId,
      issuer: normalizedIssuer,
      issuerSubject: normalizedSubject,
      linkedAt: toIso(nowMs())
    };
    state.externalIdentitiesByKey.set(key, identity);
    escalate(found.tenantId, 'system', 'identity.link', identity.userId);
    return Object.freeze({ ...identity });
  }

  function unlinkExternalIdentities({ userId, issuer } = {}) {
    const found = userIndex.get(required(userId, 'userId'));
    if (!found) throw new Error('user not found');
    const normalizedIssuer = required(issuer, 'issuer');
    const resolvedUserId = found.user.userId;
    const state = tenantState(found.tenantId);
    let removed = 0;
    for (const [key, identity] of Array.from(state.externalIdentitiesByKey.entries())) {
      if (identity.userId === resolvedUserId && identity.issuer === normalizedIssuer) {
        state.externalIdentitiesByKey.delete(key);
        removed += 1;
      }
    }
    escalate(found.tenantId, 'system', 'identity.unlink', resolvedUserId);
    return Object.freeze({ userId: resolvedUserId, issuer: normalizedIssuer, removed });
  }

  function registerServiceIdentity({ tenantId, serviceId, allowedActions } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const normalizedServiceId = required(serviceId, 'serviceId');
    if (state.serviceIdentities.has(normalizedServiceId)) throw new Error('service identity already registered');
    const actions = Object.freeze(normalizedList(allowedActions, 'allowedActions'));
    const identity = {
      tenantId: id,
      serviceId: normalizedServiceId,
      allowedActions: actions,
      registeredAt: toIso(nowMs())
    };
    state.serviceIdentities.set(normalizedServiceId, identity);
    escalate(id, 'system', 'service_identity.register', normalizedServiceId);
    return Object.freeze({ ...identity });
  }

  function issueApiKey({ tenantId, actorId, scopes, actions } = {}) {
    const id = required(tenantId, 'tenantId');
    const owner = required(actorId, 'actorId');
    const state = tenantState(id);
    const normalizedScopes = normalizedList(scopes, 'scopes');
    const normalizedActions = normalizedList(actions, 'actions');
    const selector = randomBytes(12).toString('base64url');
    const secret = randomBytes(24).toString('base64url');
    const token = `za_${selector}.${secret}`;
    const record = {
      keyId: `ak_${randomUUID()}`,
      tenantId: id,
      actorId: owner,
      scopes: normalizedScopes,
      actions: normalizedActions,
      selector,
      tokenHash: deriveSecret(secret),
      createdAt: toIso(nowMs()),
      revokedAt: null,
      disabledAt: null
    };
    state.apiKeysById.set(record.keyId, record);
    state.apiKeysByHash.set(selector, record);
    apiKeyIndex.set(record.keyId, record);
    apiKeySelectorIndex.set(selector, record);
    escalate(id, owner, 'api_key.issue', record.keyId);
    return Object.freeze({
      keyId: record.keyId,
      tenantId: id,
      actorId: owner,
      token,
      scopes: Object.freeze([...normalizedScopes]),
      actions: Object.freeze([...normalizedActions]),
      createdAt: record.createdAt
    });
  }

  function authenticateApiKey(token, requiredAction) {
    const deny = (reason) => Object.freeze({ authenticated: false, reason, keyId: null, tenantId: null });
    const match = String(token ?? '').match(/^za_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{32})$/);
    if (!match) return deny('unknown_key');
    const record = apiKeySelectorIndex.get(match[1]);
    if (!record || !verifyDerivedSecret(match[2], record.tokenHash)) return deny('unknown_key');
    if (record.revokedAt) return deny('revoked');
    if (record.disabledAt) return deny('disabled');
    const action = String(requiredAction ?? '').trim().toLowerCase();
    if (!action || !record.actions.includes(action)) return deny('action_denied');
    return Object.freeze({
      authenticated: true,
      reason: 'authorized',
      keyId: record.keyId,
      tenantId: record.tenantId,
      actorId: record.actorId,
      scopes: Object.freeze([...record.scopes]),
      actions: Object.freeze([...record.actions])
    });
  }

  function revokeApiKey(keyId) {
    const record = apiKeyIndex.get(required(keyId, 'keyId'));
    if (!record) throw new Error('api key not found');
    if (!record.revokedAt) {
      record.revokedAt = toIso(nowMs());
      escalate(record.tenantId, record.actorId, 'api_key.revoke', record.keyId);
    }
    return Object.freeze({ keyId: record.keyId, tenantId: record.tenantId, revokedAt: record.revokedAt });
  }

  function disableApiKey(keyId) {
    const record = apiKeyIndex.get(required(keyId, 'keyId'));
    if (!record) throw new Error('api key not found');
    if (!record.disabledAt) {
      record.disabledAt = toIso(nowMs());
      escalate(record.tenantId, record.actorId, 'api_key.disable', record.keyId);
    }
    return Object.freeze({ keyId: record.keyId, tenantId: record.tenantId, disabledAt: record.disabledAt });
  }

  function definePlan({ planId, quotas = {}, ratePlan = {}, features = [] } = {}) {
    const id = required(planId, 'planId');
    if (plans.has(id)) throw new Error('plan already defined');
    if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) throw new Error('quotas must be an object');
    if (!ratePlan || typeof ratePlan !== 'object' || Array.isArray(ratePlan)) throw new Error('ratePlan must be an object');
    if (!Array.isArray(features)) throw new Error('features must be an array');
    const normalizedQuotas = {};
    for (const [metric, limit] of Object.entries(quotas)) {
      normalizedQuotas[required(metric, 'quota metric')] = requireNonNegativeInteger(limit, `quota ${metric}`);
    }
    const normalizedRates = {};
    for (const [metric, price] of Object.entries(ratePlan)) {
      normalizedRates[required(metric, 'rate metric')] = requireNonNegativeInteger(price, `ratePlan ${metric}`);
    }
    const normalizedFeatures = [...new Set(features.map((feature) => required(feature, 'feature')))].sort();
    const plan = Object.freeze({
      planId: id,
      quotas: Object.freeze(normalizedQuotas),
      ratePlan: Object.freeze(normalizedRates),
      features: Object.freeze(normalizedFeatures)
    });
    plans.set(id, plan);
    return plan;
  }

  function assignEntitlement(tenantId, planId, period) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const plan = plans.get(required(planId, 'planId'));
    if (!plan) throw new Error('plan not found');
    const normalizedPeriod = required(period, 'period');
    const entitlement = {
      entitlementId: `ent_${randomUUID()}`,
      tenantId: id,
      planId: plan.planId,
      period: normalizedPeriod,
      assignedAt: toIso(nowMs())
    };
    state.entitlements.push(entitlement);
    escalate(id, 'system', 'entitlement.assign', `${plan.planId}@${normalizedPeriod}`);
    return Object.freeze({ ...entitlement });
  }

  function meterUsage({ tenantId, metric, quantity = 1, at } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const normalizedMetric = required(metric, 'metric');
    requirePositiveInteger(quantity, 'quantity');
    const atMs = at == null ? nowMs() : toTimestamp(at, 'at');
    const fail = (reason) => Object.assign(new Error(reason), { reason });
    const plan = currentPlan(state);
    if (!plan) throw fail('quota_undefined');
    const limit = plan.quotas[normalizedMetric];
    if (limit == null) throw fail('quota_undefined');
    const used = state.usageTotalsByMetric.get(normalizedMetric) || 0;
    if (used + quantity > limit) throw fail('quota_exceeded');
    const event = Object.freeze({
      eventId: `use_${randomUUID()}`,
      tenantId: id,
      metric: normalizedMetric,
      quantity,
      at: toIso(atMs)
    });
    state.usageEvents.push(event);
    state.usageTotalsByMetric.set(normalizedMetric, used + quantity);
    return event;
  }

  function listUsageEvents(tenantId) {
    const state = tenantState(required(tenantId, 'tenantId'));
    return Object.freeze(state.usageEvents.map((event) => Object.freeze({ ...event })));
  }

  function postLedgerEntry({ tenantId, debit, credit, ref } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const debitAccount = required(debit?.account, 'debit.account');
    const creditAccount = required(credit?.account, 'credit.account');
    const debitAmount = requireAmountMinorUnits(debit?.amountMinorUnits, 'debit.amountMinorUnits');
    const creditAmount = requireAmountMinorUnits(credit?.amountMinorUnits, 'credit.amountMinorUnits');
    if (debitAmount !== creditAmount) throw new Error(`ledger entry is not balanced: debit ${debitAmount} != credit ${creditAmount}`);
    const sequence = state.ledgerSequence + 1;
    const entry = {
      tenantId: id,
      sequence,
      at: toIso(nowMs()),
      debit: { account: debitAccount, amountMinorUnits: debitAmount },
      credit: { account: creditAccount, amountMinorUnits: creditAmount },
      ref: required(ref, 'ref')
    };
    state.ledgerSequence = sequence;
    state.ledgerEntries.push(entry);
    return freezeLedgerEntry(entry);
  }

  function freezeLedgerEntry(entry) {
    return Object.freeze({
      ...entry,
      debit: Object.freeze({ ...entry.debit }),
      credit: Object.freeze({ ...entry.credit })
    });
  }

  function listLedgerEntries(tenantId) {
    const state = tenantState(required(tenantId, 'tenantId'));
    return Object.freeze(state.ledgerEntries.map((entry) => freezeLedgerEntry(entry)));
  }

  function reconcileLedger(tenantId) {
    const state = tenantState(required(tenantId, 'tenantId'));
    const entries = state.ledgerEntries;
    let totalDebit = 0;
    let totalCredit = 0;
    let sequencesContinuous = true;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      totalDebit += entry.debit.amountMinorUnits;
      totalCredit += entry.credit.amountMinorUnits;
      if (entry.sequence !== index + 1) sequencesContinuous = false;
    }
    const balanced = totalDebit === totalCredit;
    return Object.freeze({
      tenantId: state.id,
      entriesCount: entries.length,
      totalDebitMinorUnits: totalDebit,
      totalCreditMinorUnits: totalCredit,
      balanced,
      sequencesContinuous,
      valid: balanced && sequencesContinuous
    });
  }

  function freezeInvoice(invoice) {
    return Object.freeze({
      invoiceId: invoice.invoiceId,
      tenantId: invoice.tenantId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      status: invoice.status,
      lineItems: Object.freeze(invoice.lineItems.map((line) => Object.freeze({ ...line }))),
      totalMinorUnits: invoice.totalMinorUnits,
      paidMinorUnits: invoice.paidMinorUnits,
      outstandingMinorUnits: Math.max(0, invoice.totalMinorUnits - invoice.paidMinorUnits),
      overpaymentMinorUnits: invoice.overpaymentMinorUnits,
      createdAt: invoice.createdAt,
      issuedAt: invoice.issuedAt,
      payments: Object.freeze(invoice.payments.map((payment) => Object.freeze({ ...payment })))
    });
  }

  function draftInvoice({ tenantId, periodStart, periodEnd } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    const startMs = toTimestamp(periodStart, 'periodStart');
    const endMs = toTimestamp(periodEnd, 'periodEnd');
    if (startMs >= endMs) throw new Error('periodStart must precede periodEnd');
    const plan = currentPlan(state);
    if (!plan) throw new Error('no active entitlement for tenant');
    const quantities = new Map();
    for (const event of state.usageEvents) {
      const atMs = toTimestamp(event.at, 'usage.at');
      if (atMs < startMs || atMs > endMs) continue;
      quantities.set(event.metric, (quantities.get(event.metric) || 0) + event.quantity);
    }
    const lineItems = [];
    let total = 0;
    for (const metric of [...quantities.keys()].sort()) {
      const unitPrice = plan.ratePlan[metric];
      if (unitPrice == null) continue;
      const quantity = quantities.get(metric);
      const amount = quantity * unitPrice;
      if (!Number.isSafeInteger(amount)) throw new Error('invoice line amount overflow');
      lineItems.push(Object.freeze({ metric, quantity, unitPriceMinorUnits: unitPrice, amountMinorUnits: amount }));
      total += amount;
      if (!Number.isSafeInteger(total)) throw new Error('invoice total overflow');
    }
    const invoice = {
      invoiceId: `inv_${randomUUID()}`,
      tenantId: id,
      periodStart: toIso(startMs),
      periodEnd: toIso(endMs),
      status: 'draft',
      lineItems,
      totalMinorUnits: total,
      paidMinorUnits: 0,
      overpaymentMinorUnits: 0,
      createdAt: toIso(nowMs()),
      issuedAt: null,
      payments: []
    };
    state.invoicesById.set(invoice.invoiceId, invoice);
    invoiceIndex.set(invoice.invoiceId, invoice);
    return freezeInvoice(invoice);
  }

  function issueInvoice(invoiceId) {
    const invoice = invoiceIndex.get(required(invoiceId, 'invoiceId'));
    if (!invoice) throw new Error('invoice not found');
    if (invoice.status !== 'draft') throw new Error('invoice already issued');
    invoice.status = 'issued';
    invoice.issuedAt = toIso(nowMs());
    return freezeInvoice(invoice);
  }

  function recordPayment({ invoiceId, amountMinorUnits, providerRef } = {}) {
    const invoice = invoiceIndex.get(required(invoiceId, 'invoiceId'));
    if (!invoice) throw new Error('invoice not found');
    if (invoice.status === 'draft') throw new Error('cannot record payment on draft invoice');
    const amount = requireAmountMinorUnits(amountMinorUnits, 'amountMinorUnits');
    const reference = required(providerRef, 'providerRef');
    invoice.payments.push({ at: toIso(nowMs()), amountMinorUnits: amount, providerRef: reference });
    invoice.paidMinorUnits += amount;
    invoice.overpaymentMinorUnits = Math.max(0, invoice.paidMinorUnits - invoice.totalMinorUnits);
    invoice.status = invoice.paidMinorUnits >= invoice.totalMinorUnits ? 'paid' : 'partially_paid';
    return freezeInvoice(invoice);
  }

  function provisionAdminBootstrap({ tenantId, ttlMinutes } = {}) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    if (state.bootstrapDisabled) throw new Error('bootstrap_disabled');
    const ttlMs = requirePositiveInteger(ttlMinutes, 'ttlMinutes') * 60000;
    const now = nowMs();
    const existing = state.bootstrapGrant;
    if (existing && toTimestamp(existing.expiresAt, 'expiresAt') > now) throw new Error('bootstrap grant already active for tenant');
    const token = opaqueToken('zb_');
    const grant = {
      grantId: `boot_${randomUUID()}`,
      tenantId: id,
      role: 'admin',
      tokenHash: deriveSecret(token),
      issuedAt: toIso(now),
      expiresAt: toIso(now + ttlMs)
    };
    state.bootstrapGrant = grant;
    escalate(id, 'system', 'bootstrap.provision', grant.grantId);
    const { tokenHash, ...publicGrant } = grant;
    return Object.freeze({ ...publicGrant, token });
  }

  function disableBootstrap(tenantId) {
    const id = required(tenantId, 'tenantId');
    const state = tenantState(id);
    if (!state.bootstrapDisabled) {
      state.bootstrapDisabled = true;
      escalate(id, 'system', 'bootstrap.disable', id);
    }
    return Object.freeze({ tenantId: id, disabled: true });
  }

  function getEscalationLog(tenantId) {
    if (tenantId == null) return Object.freeze([...escalationLog]);
    const id = required(tenantId, 'tenantId');
    return Object.freeze(escalationLog.filter((entry) => entry.tenantId === id));
  }

  const _hooks = Object.freeze({
    corruptLedgerEntry(tenantId, sequence, mutate) {
      const state = tenantState(required(tenantId, 'tenantId'));
      const target = requirePositiveInteger(sequence, 'sequence');
      const entry = state.ledgerEntries.find((candidate) => candidate.sequence === target);
      if (!entry) throw new Error('ledger entry not found');
      if (typeof mutate !== 'function') throw new Error('mutate must be a function');
      mutate(entry);
    },
    rawApiKeyRecords() {
      return Object.freeze([...apiKeyIndex.values()].map((record) => Object.freeze({
        ...record,
        scopes: Object.freeze([...record.scopes]),
        actions: Object.freeze([...record.actions])
      })));
    }
  });

  return Object.freeze({
    createUser,
    startSession,
    verifySession,
    revokeSession,
    linkExternalIdentity,
    unlinkExternalIdentities,
    registerServiceIdentity,
    issueApiKey,
    authenticateApiKey,
    revokeApiKey,
    disableApiKey,
    definePlan,
    assignEntitlement,
    meterUsage,
    listUsageEvents,
    postLedgerEntry,
    listLedgerEntries,
    reconcileLedger,
    draftInvoice,
    issueInvoice,
    recordPayment,
    provisionAdminBootstrap,
    disableBootstrap,
    getEscalationLog,
    _hooks
  });
}
