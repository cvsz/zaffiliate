export class SchemaError extends Error {
  constructor(issues) {
    super(`schema validation failed: ${issues.map((issue) => `${issue.path || '(root)'} ${issue.message}`).join('; ')}`);
    this.name = 'SchemaError';
    this.code = 'SCHEMA_VALIDATION_FAILED';
    this.issues = Object.freeze(issues);
  }
}

function issue(path, message) {
  return { path, message };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkString(value, path, opts = {}) {
  if (typeof value !== 'string') return [issue(path, `expected string, got ${typeOf(value)}`)];
  const errors = [];
  if (opts.min != null && value.length < opts.min) errors.push(issue(path, `length must be >= ${opts.min}`));
  if (opts.max != null && value.length > opts.max) errors.push(issue(path, `length must be <= ${opts.max}`));
  if (opts.pattern && !opts.pattern.test(value)) errors.push(issue(path, opts.patternMessage || 'format is invalid'));
  if (!opts.keepWhitespace && value !== value.trim()) errors.push(issue(path, 'must not have surrounding whitespace'));
  return errors;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function makeSchema(validate) {
  return {
    kind: 'schema',
    parse(value) {
      const errors = validate(value, '');
      if (errors.length > 0) throw new SchemaError(errors);
      return value;
    },
    safeParse(value) {
      const errors = validate(value, '');
      if (errors.length > 0) return { ok: false, issues: Object.freeze(errors) };
      return { ok: true, value };
    },
    refine(fn, message) {
      return makeSchema((value, path) => {
        const errors = validate(value, path);
        if (errors.length > 0) return errors;
        let result;
        try {
          result = fn(value);
        } catch (error) {
          return [issue(path, error instanceof Error ? error.message : String(error))];
        }
        if (result === true) return [];
        return [issue(Array.isArray(result?.path) ? result.path.join('.') : path, result?.message || message)];
      });
    }
  };
}

function joinPath(base, key) {
  return base ? `${base}.${key}` : String(key);
}

function innerErrors(inner, value, path) {
  const result = inner.safeParse(value);
  if (result.ok) return [];
  return result.issues.map((err) => ({ path: joinPath(path, err.path), message: err.message }));
}

function makeWrapper(validate) {
  const schema = makeSchema(validate);
  return { kind: 'optional', validate, parse: schema.parse, safeParse: schema.safeParse };
}

export function optional(inner) {
  return makeWrapper((value, path) => (value === undefined ? [] : innerErrors(inner, value, path)));
}

export function nullable(inner) {
  return makeWrapper((value, path) => (value === null ? [] : innerErrors(inner, value, path)));
}

export const string = (opts = {}) => makeSchema((value, path) => checkString(value, path, opts));

string.uuid = () => makeSchema((value, path) => checkString(value, path, { pattern: UUID_PATTERN, patternMessage: 'expected uuid', keepWhitespace: true }));

string.datetime = () => makeSchema((value, path) => checkString(value, path, { pattern: DATETIME_PATTERN, patternMessage: 'expected ISO-8601 datetime', keepWhitespace: true }));

string.hex = (opts = {}) => makeSchema((value, path) => checkString(value, path, { ...opts, pattern: /^[0-9a-f]+$/, patternMessage: 'expected lowercase hex', keepWhitespace: true }));

export const number = (opts = {}) => makeSchema((value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [issue(path, `expected number, got ${typeOf(value)}`)];
  const errors = [];
  if (opts.integer && !Number.isInteger(value)) errors.push(issue(path, 'expected integer'));
  if (opts.min != null && value < opts.min) errors.push(issue(path, `must be >= ${opts.min}`));
  if (opts.max != null && value > opts.max) errors.push(issue(path, `must be <= ${opts.max}`));
  return errors;
});

export const boolean = () => makeSchema((value, path) => (typeof value === 'boolean' ? [] : [issue(path, `expected boolean, got ${typeOf(value)}`)]));

export const oneOf = (values) => makeSchema((value, path) => (values.includes(value) ? [] : [issue(path, `expected one of [${values.join(', ')}], got ${JSON.stringify(value)}`)]));

export const arrayOf = (inner, opts = {}) => makeSchema((value, path) => {
  if (!Array.isArray(value)) return [issue(path, `expected array, got ${typeOf(value)}`)];
  const errors = [];
  if (opts.min != null && value.length < opts.min) errors.push(issue(path, `length must be >= ${opts.min}`));
  if (opts.max != null && value.length > opts.max) errors.push(issue(path, `length must be <= ${opts.max}`));
  value.forEach((item, index) => {
    for (const err of innerErrors(inner, item, joinPath(path, index))) errors.push(err);
  });
  return errors;
});

export const recordOf = (inner) => makeSchema((value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [issue(path, `expected object, got ${typeOf(value)}`)];
  const errors = [];
  for (const [key, item] of Object.entries(value)) {
    for (const err of innerErrors(inner, item, joinPath(path, key))) errors.push(err);
  }
  return errors;
});

export function object(shape) {
  return makeSchema((value, basePath) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [issue(basePath, `expected object, got ${typeOf(value)}`)];
    const errors = [];
    for (const [key, spec] of Object.entries(shape)) {
      const path = joinPath(basePath, key);
      const fieldValue = value[key];
      if (fieldValue === undefined) {
        if (spec.kind !== 'optional') errors.push(issue(path, 'is required'));
        continue;
      }
      const result = spec.safeParse(fieldValue);
      if (!result.ok) {
        for (const err of result.issues) errors.push({ path: joinPath(path, err.path), message: err.message });
      }
    }
    return errors;
  });
}

export function safeParse(schema, value) {
  return schema.safeParse(value);
}

const Platforms = Object.freeze(['tiktok', 'shopee', 'lazada', 'facebook', 'instagram', 'youtube', 'line']);
const Roles = Object.freeze(['owner', 'admin', 'operator', 'analyst', 'affiliate', 'member', 'service', 'viewer']);

const idFields = {
  id: string.uuid(),
  orgId: string.uuid(),
  createdAt: string.datetime()
};

export const MerchantSchema = object({
  ...idFields,
  providerId: string.uuid(),
  externalId: string({ min: 1, max: 255 }),
  name: string({ min: 1, max: 255 })
});

export const ProductSchema = object({
  ...idFields,
  merchantId: nullable(string.uuid()),
  externalId: nullable(string({ min: 1, max: 255 })),
  title: string({ min: 1, max: 500 }),
  description: nullable(string({ max: 5000 })),
  priceAmount: number({ min: 0 }),
  currency: string({ min: 3, max: 3 }),
  status: oneOf(['discovered', 'evaluated', 'selected', 'archived']),
  metadata: recordOf(makeSchema(() => []))
});

export const OfferSchema = object({
  ...idFields,
  productId: string.uuid(),
  url: makeSchema((value, path) => {
    const errors = checkString(value, path, {});
    if (errors.length > 0) return errors;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') return [issue(path, 'offer url must use HTTPS')];
      return [];
    } catch {
      return [issue(path, 'expected absolute https url')];
    }
  }),
  commissionType: oneOf(['percentage', 'fixed']),
  commissionValue: number({ min: 0 })
}).refine(
  (offer) => offer.commissionType !== 'percentage' || offer.commissionValue <= 100,
  { path: ['commissionValue'], message: 'percentage commission cannot exceed 100' }
);

export const CampaignStatus = Object.freeze(['draft', 'active', 'paused', 'completed', 'cancelled']);

export const CampaignTransitions = Object.freeze({
  draft: Object.freeze(['active', 'cancelled']),
  active: Object.freeze(['paused', 'completed', 'cancelled']),
  paused: Object.freeze(['active', 'completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});

export function canTransitionCampaign(from, to) {
  return CampaignTransitions[from]?.includes(to) ?? false;
}

export const CampaignSchema = object({
  ...idFields,
  name: string({ min: 1, max: 255 }),
  status: oneOf(CampaignStatus),
  objective: nullable(string({ max: 500 })),
  budgetLimit: nullable(number({ min: 0 }))
});

export const AffiliateLinkSchema = object({
  ...idFields,
  campaignId: nullable(string.uuid()),
  offerId: nullable(string.uuid()),
  slug: string({ min: 1, max: 128, pattern: /^[a-z0-9][a-z0-9-]*$/, patternMessage: 'slug must be lowercase letters, digits and hyphens', keepWhitespace: false }),
  targetUrl: string({}).refine((url) => {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'targetUrl must be an absolute https url'),
  utm: recordOf(string({ min: 1 })),
  expiresAt: nullable(string.datetime())
});

export const AffiliateClickSchema = object({
  ...idFields,
  linkId: string.uuid(),
  visitorHash: string({ min: 8, max: 128, keepWhitespace: true }),
  occurredAt: string.datetime()
});

export const ConversionStatusValues = Object.freeze(['pending', 'confirmed', 'refunded', 'rejected']);

export const ConversionSchema = object({
  ...idFields,
  linkId: nullable(string.uuid()),
  externalOrderId: string({ min: 1, max: 255 }),
  amount: number({ min: 0 }),
  currency: string({ min: 3, max: 3 }),
  commissionAmount: number({ min: 0 }),
  status: oneOf(ConversionStatusValues),
  occurredAt: string.datetime(),
  recordedAt: string.datetime()
});

export const PublicationJobStatus = Object.freeze([
  'draft', 'waiting_approval', 'approved', 'scheduled', 'processing', 'published', 'partial', 'failed', 'cancelled'
]);

export const PublicationJobSchema = object({
  ...idFields,
  contentItemId: string.uuid(),
  platform: oneOf(Platforms),
  status: oneOf(PublicationJobStatus),
  idempotencyKey: string({ min: 1, max: 255 }),
  attempt: number({ integer: true, min: 0 }),
  maxAttempts: number({ integer: true, min: 1 }),
  nextRetryAt: nullable(string.datetime()),
  providerResponse: nullable(recordOf(makeSchema(() => []))),
  externalContentId: nullable(string({ min: 1, max: 255 })),
  failureCode: nullable(string({ min: 1, max: 64 })),
  failureReason: nullable(string({ max: 1000 })),
  scheduledFor: nullable(string.datetime()),
  updatedAt: string.datetime()
});

export const ContentItemSchema = object({
  ...idFields,
  campaignId: string.uuid(),
  productRef: string({ min: 1, max: 255 }),
  kind: oneOf(['copy', 'image', 'video-script', 'voice', 'captions', 'storyboard']),
  promptVersion: string({ min: 1, max: 32 }),
  model: string({ min: 1, max: 128 }),
  version: number({ integer: true, min: 1 }),
  status: oneOf(['draft', 'in_review', 'approved', 'rejected', 'archived']),
  body: recordOf(makeSchema(() => [])),
  disclosureRequired: boolean()
});

export const ExperimentSchema = object({
  ...idFields,
  campaignId: string.uuid(),
  hypothesis: string({ min: 1, max: 500 }),
  variants: arrayOf(object({
    key: string({ min: 1, max: 64 }),
    weight: number({ integer: true, min: 1, max: 100 })
  }), { min: 2, max: 10 }),
  minSamplesPerVariant: number({ integer: true, min: 1 }),
  status: oneOf(['running', 'stopped', 'completed']),
  winnerVariant: nullable(string({ min: 1, max: 64 })),
  createdAt: string.datetime()
}).refine((experiment) => {
  const totalWeight = experiment.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight !== 100) return { path: ['variants'], message: 'variant weights must sum to 100' };
  if (experiment.winnerVariant !== null && experiment.status !== 'completed') {
    return { path: ['winnerVariant'], message: 'winner cannot be declared before experiment completion' };
  }
  return true;
}, 'experiment invariant violated');

export const ApprovalRequestSchema = object({
  ...idFields,
  subjectType: string({ min: 1, max: 64 }),
  subjectId: string.uuid(),
  requestedBy: string.uuid(),
  status: oneOf(['pending', 'approved', 'rejected', 'expired', 'cancelled']),
  reason: string({ min: 1, max: 500 }),
  decidedBy: nullable(string.uuid()),
  decision: nullable(oneOf(['approved', 'rejected'])),
  expiresAt: string.datetime(),
  createdAt: string.datetime()
}).refine((approval) => {
  const hasDecision = approval.decision !== null;
  const hasDecider = approval.decidedBy !== null;
  if (hasDecision !== hasDecider) {
    return { path: ['decision'], message: 'decision and decidedBy must be set together' };
  }
  if (hasDecision && approval.status === 'pending') {
    return { path: ['status'], message: 'pending approvals cannot carry a recorded decision' };
  }
  return true;
}, 'approval invariant violated');

export const WebhookEventSchema = object({
  ...idFields,
  platform: oneOf(Platforms),
  externalEventId: string({ min: 1, max: 255 }),
  signatureValid: boolean(),
  payload: recordOf(makeSchema(() => [])),
  receivedAt: string.datetime()
});

export const AuditEventSchema = object({
  ...idFields,
  actorId: string.uuid(),
  action: string({ min: 1, max: 128 }),
  resourceType: string({ min: 1, max: 64 }),
  resourceId: string({ min: 1, max: 255 }),
  outcome: oneOf(['allowed', 'denied']),
  reason: string({ min: 1, max: 128 }),
  prevHash: string.hex({ min: 8, max: 128 }),
  entryHash: string.hex({ min: 8, max: 128 }),
  occurredAt: string.datetime()
});

export const MembershipSchema = object({
  ...idFields,
  actorId: string.uuid(),
  role: oneOf(Roles),
  status: oneOf(['active', 'suspended', 'revoked'])
});

export const DomainPlatforms = Platforms;
export const DomainRoles = Roles;
