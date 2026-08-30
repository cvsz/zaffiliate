import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../../packages/security/src/passwords.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const RECOVERY_RATE_WINDOW_MS = 10 * 60 * 1000;

export class LocalAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'LocalAuthError';
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new LocalAuthError(400, 'INVALID_EMAIL', 'email is invalid');
  }
  return email;
}

function validateOrgName(value) {
  const name = String(value ?? '').trim();
  if (name.length < 2 || name.length > 120) throw new LocalAuthError(400, 'INVALID_ORG_NAME', 'organization name must be 2-120 characters');
  return name;
}

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

function opaqueToken(prefix) {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function tenantSlug(name) {
  const stem = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant';
  return `${stem}-${randomBytes(5).toString('hex')}`;
}

function publicUser(user) {
  return Object.freeze({
    tenantId: user.tenantId,
    userId: user.userId,
    email: user.email,
    role: user.role ?? 'owner',
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt
  });
}

function publicAuditEvent(event) {
  return Object.freeze({
    id: event.id,
    tenantId: event.tenantId,
    actorId: event.actorId,
    requestId: event.requestId ?? null,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    reason: event.reason,
    occurredAt: event.occurredAt,
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {}
  });
}

export function createNoopRecoverySender({ logger = null } = {}) {
  const info = typeof logger?.info === 'function' ? logger.info.bind(logger) : () => {};
  return Object.freeze({
    async sendEmailVerification(_email, _rawToken) {
      info('auth_email_verification_queued', { delivery: 'noop' });
    },
    async sendPasswordReset(_email, _rawToken) {
      info('auth_password_reset_queued', { delivery: 'noop' });
    }
  });
}

export function createLocalAuthService({ repo, clock = Date.now, sender = createNoopRecoverySender() } = {}) {
  if (!repo || typeof repo.findCredentialsByEmail !== 'function') throw new TypeError('auth repo is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!sender || typeof sender.sendEmailVerification !== 'function' || typeof sender.sendPasswordReset !== 'function') {
    throw new TypeError('recovery sender is invalid');
  }

  let dummyPasswordHash = null;
  async function dummyVerify(password) {
    if (!dummyPasswordHash) dummyPasswordHash = await hashPassword('zaffiliate-dummy-password-for-timing-equalization');
    return verifyPassword(dummyPasswordHash, String(password ?? ''));
  }

  async function register({ orgName, email, password } = {}) {
    const name = validateOrgName(orgName);
    const normalizedEmail = normalizeEmail(email);
    let passwordHash;
    try { passwordHash = await hashPassword(password); }
    catch (error) {
      if (error?.code === 'WEAK_PASSWORD') throw new LocalAuthError(400, 'WEAK_PASSWORD', error.message);
      throw error;
    }
    const tenantId = randomUUID();
    const userId = `usr_${randomUUID()}`;
    try {
      const created = await repo.createTenantOwner({
        tenantId,
        tenantSlug: tenantSlug(name),
        tenantName: name,
        userId,
        email: normalizedEmail,
        passwordHash
      });
      return publicUser({ ...created, role: 'owner' });
    } catch (error) {
      if (error?.code === '23505') throw new LocalAuthError(409, 'REGISTRATION_CONFLICT', 'unable to register with the provided details');
      throw error;
    }
  }

  async function login({ tenantId, email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const credentials = await repo.findCredentialsByEmail(tenantId, normalizedEmail);
    let valid = false;
    if (credentials) valid = await verifyPassword(credentials.passwordHash, String(password ?? ''));
    else await dummyVerify(password);
    if (!credentials || !valid) {
      if (credentials) await repo.auditLoginFailure(tenantId, credentials.userId);
      throw new LocalAuthError(401, 'INVALID_CREDENTIALS', 'invalid email or password');
    }
    const token = opaqueToken('zs_');
    const expiresAt = new Date(clock() + SESSION_TTL_MS);
    await repo.createSession({ tenantId, userId: credentials.userId, tokenHash: hashToken(token), expiresAt });
    return Object.freeze({ token, expiresAt: expiresAt.toISOString(), user: publicUser(credentials) });
  }

  async function getSession({ tenantId, token } = {}) {
    const raw = String(token ?? '');
    if (!raw || raw.length > 512) return null;
    const session = await repo.findSessionByHash(tenantId, hashToken(raw));
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= clock()) return null;
    return Object.freeze({
      sessionId: session.id,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: publicUser(session)
    });
  }

  async function logout({ tenantId, token } = {}) {
    const raw = String(token ?? '');
    if (!raw || raw.length > 512) return Object.freeze({ revoked: false });
    const revoked = await repo.revokeSession(tenantId, hashToken(raw));
    return Object.freeze({ revoked: Boolean(revoked) });
  }

  async function listTenantUsers({ tenantId, limit = 50 } = {}) {
    if (typeof repo.listUsers !== 'function') throw new Error('user listing is unavailable');
    const users = await repo.listUsers(tenantId, { limit });
    return Object.freeze(users.map(publicUser));
  }

  async function listAuditEvents({ tenantId, limit = 50 } = {}) {
    if (typeof repo.listAuditEvents !== 'function') throw new Error('audit listing is unavailable');
    const events = await repo.listAuditEvents(tenantId, { limit });
    return Object.freeze(events.map(publicAuditEvent));
  }

  async function requestPasswordReset({ tenantId, email } = {}) {
    let normalizedEmail;
    try { normalizedEmail = normalizeEmail(email); }
    catch { return Object.freeze({ accepted: true }); }
    const user = await repo.findCredentialsByEmail(tenantId, normalizedEmail);
    if (!user) return Object.freeze({ accepted: true });
    const rawToken = opaqueToken('zr_');
    const expiresAt = new Date(clock() + PASSWORD_RESET_TTL_MS);
    try {
      await repo.createRecoveryToken({
        tenantId,
        userId: user.userId,
        purpose: 'password_reset',
        tokenHash: hashToken(rawToken),
        expiresAt,
        windowStart: new Date(clock() - RECOVERY_RATE_WINDOW_MS),
        maxRecent: 3
      });
    } catch (error) {
      if (error?.code === 'RECOVERY_RATE_LIMITED') return Object.freeze({ accepted: true });
      throw error;
    }
    await sender.sendPasswordReset(user.email, rawToken);
    return Object.freeze({ accepted: true });
  }

  async function resetPassword({ tenantId, token, newPassword } = {}) {
    const raw = String(token ?? '');
    if (!raw || raw.length > 512) throw new LocalAuthError(400, 'INVALID_RECOVERY_TOKEN', 'this link is invalid or has expired');
    let passwordHash;
    try { passwordHash = await hashPassword(newPassword); }
    catch (error) {
      if (error?.code === 'WEAK_PASSWORD') throw new LocalAuthError(400, 'WEAK_PASSWORD', error.message);
      throw error;
    }
    const result = await repo.resetPassword({ tenantId, tokenHash: hashToken(raw), passwordHash });
    if (!result) throw new LocalAuthError(400, 'INVALID_RECOVERY_TOKEN', 'this link is invalid or has expired');
    return Object.freeze({ reset: true, userId: result.userId });
  }

  async function requestEmailVerification({ tenantId, userId } = {}) {
    const user = await repo.findUserById(tenantId, userId);
    if (!user) throw new LocalAuthError(404, 'USER_NOT_FOUND', 'user not found');
    if (user.emailVerified) return Object.freeze({ accepted: true, alreadyVerified: true });
    const rawToken = opaqueToken('zv_');
    const expiresAt = new Date(clock() + EMAIL_VERIFY_TTL_MS);
    try {
      await repo.createRecoveryToken({
        tenantId,
        userId,
        purpose: 'email_verify',
        tokenHash: hashToken(rawToken),
        expiresAt,
        windowStart: new Date(clock() - RECOVERY_RATE_WINDOW_MS),
        maxRecent: 3
      });
    } catch (error) {
      if (error?.code === 'RECOVERY_RATE_LIMITED') throw new LocalAuthError(429, 'RECOVERY_RATE_LIMITED', 'too many requests; try again later');
      throw error;
    }
    await sender.sendEmailVerification(user.email, rawToken);
    return Object.freeze({ accepted: true, expiresAt: expiresAt.toISOString() });
  }

  async function confirmEmailVerification({ tenantId, token } = {}) {
    const raw = String(token ?? '');
    if (!raw || raw.length > 512) throw new LocalAuthError(400, 'INVALID_RECOVERY_TOKEN', 'this link is invalid or has expired');
    const result = await repo.confirmEmailVerification({ tenantId, tokenHash: hashToken(raw) });
    if (!result) throw new LocalAuthError(400, 'INVALID_RECOVERY_TOKEN', 'this link is invalid or has expired');
    return Object.freeze({ verified: true, userId: result.userId });
  }

  return Object.freeze({
    register,
    login,
    getSession,
    logout,
    listTenantUsers,
    listAuditEvents,
    requestPasswordReset,
    resetPassword,
    requestEmailVerification,
    confirmEmailVerification
  });
}
