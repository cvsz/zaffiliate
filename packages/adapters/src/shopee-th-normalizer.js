// Shopee Thailand Affiliate — verified product-feed contract.
//
// Deterministic CSV/datafeed normalization for the Shopee Thailand Affiliate
// product feed. Headers are recognized from the verified Thai strings in
// shopee-th-constants.js. Unknown schemas fail closed: no guessing, no
// silent coercion, no fabricated values.

import {
  SHOPEE_TH_FEED_SCHEMA_VERSION,
  SHOPEE_TH_FEED_FIELDS,
  SHOPEE_TH_PRODUCT_FEED_HEADERS,
  SHOPEE_TH_PRODUCT_ID_ALIASES,
  SHOPEE_TH_QUANTITY_WORDS,
  SHOPEE_TH_MONEY_MINOR_UNITS,
  SHOPEE_TH_RATE_BASIS_POINTS,
  UTF8_BOM
} from './shopee-th-constants.js';

export class ShopeeThFeedError extends Error {
  constructor(message, code = 'SHOPEE_TH_FEED_ERROR', details = null) {
    super(message);
    this.name = 'ShopeeThFeedError';
    this.code = code;
    this.details = details == null ? null : Object.freeze(details);
  }
}

function fail(code, message, details = null) {
  throw new ShopeeThFeedError(message, code, details);
}

function requireNonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) fail('field_required', `${label} is required`);
  return text;
}

function requireInteger(value, label) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+$/.test(text)) fail('invalid_integer', `${label} must be an integer, got: ${JSON.stringify(value)}`);
  return Number(text);
}

function requireDecimal(value, label) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) fail('invalid_decimal', `${label} must be a decimal number, got: ${JSON.stringify(value)}`);
  return Number(text);
}

function requirePositiveDecimal(value, label) {
  const n = requireDecimal(value, label);
  if (n < 0) fail('invalid_decimal', `${label} must be non-negative, got: ${JSON.stringify(value)}`);
  return n;
}

function requireHttpsUrl(value, label) {
  const text = requireNonEmpty(value, label);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail('invalid_url', `${label} must be a valid URL, got: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:') fail('invalid_url', `${label} must be an https URL, got: ${JSON.stringify(value)}`);
  return text;
}

// Parse a Thai quantity notation such as "5 พัน" or "2.5 หมื่น" or a bare
// integer. Multiplicative quantity words are combined with any numeric
// prefix; bare integers are returned as-is.
export function parseSoldCount(value) {
  const text = String(value ?? '').trim();
  if (!text) fail('field_required', 'sold is required');

  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)?\s*([\u0E00-\u0E7F]+)?\s*$/);
  if (!match) fail('invalid_quantity', `sold notation is not parseable: ${JSON.stringify(value)}`);

  const numericPart = match[1] == null ? null : Number(match[1]);
  const wordPart = match[2] == null ? null : match[2];

  if (wordPart == null) {
    if (numericPart == null) fail('invalid_quantity', `sold notation is not parseable: ${JSON.stringify(value)}`);
    if (!Number.isInteger(numericPart) || numericPart < 0) fail('invalid_quantity', `sold must be a non-negative integer, got: ${JSON.stringify(value)}`);
    return numericPart;
  }

  const multiplier = SHOPEE_TH_QUANTITY_WORDS[wordPart];
  if (multiplier == null) fail('unknown_quantity_word', `unknown Thai quantity word: ${JSON.stringify(wordPart)}`);

  const base = numericPart == null ? 1 : numericPart;
  const result = base * multiplier;
  if (!Number.isInteger(result) || result < 0) fail('invalid_quantity', `sold notation overflows: ${JSON.stringify(value)}`);
  return result;
}

// Parse a decimal price into minor units (integer). ฿1.00 -> 100.
export function parsePriceToMinorUnits(value) {
  const amount = requirePositiveDecimal(value, 'price');
  const minor = Math.round(amount * 10 ** SHOPEE_TH_MONEY_MINOR_UNITS);
  if (!Number.isSafeInteger(minor)) fail('money_overflow', `price overflows minor units: ${JSON.stringify(value)}`);
  return minor;
}

// Parse a percentage/rate into basis points (integer). 1.00 -> 10000.
export function parseRateToBasisPoints(value) {
  const rate = requireDecimal(value, 'commission_rate');
  const bps = Math.round(rate * SHOPEE_TH_RATE_BASIS_POINTS);
  if (!Number.isSafeInteger(bps)) fail('money_overflow', `commission rate overflows basis points: ${JSON.stringify(value)}`);
  return bps;
}

// Parse a commission amount into minor units.
export function parseCommissionAmountToMinorUnits(value) {
  const amount = requirePositiveDecimal(value, 'commission_amount');
  const minor = Math.round(amount * 10 ** SHOPEE_TH_MONEY_MINOR_UNITS);
  if (!Number.isSafeInteger(minor)) fail('money_overflow', `commission amount overflows minor units: ${JSON.stringify(value)}`);
  return minor;
}

// Build a reverse map from verified Thai header string to canonical field
// name. SHOPEE_TH_PRODUCT_FEED_HEADERS is keyed by canonical field name and
// valued by the verified Thai header, so the lookup must check values.
const HEADER_TO_FIELD = Object.fromEntries(
  Object.entries(SHOPEE_TH_PRODUCT_FEED_HEADERS).map(([field, header]) => [header, field])
);

// Map a raw header string to its canonical field name, or null when the
// header is not part of the verified contract. Product ID accepts a small
// explicit alias set because its exact Thai header is unverified.
export function resolveHeader(rawHeader) {
  const header = String(rawHeader ?? '').trim();
  if (!header) return null;

  const field = HEADER_TO_FIELD[header];
  if (field != null) return field;

  if (SHOPEE_TH_PRODUCT_ID_ALIASES.includes(header)) {
    return SHOPEE_TH_FEED_FIELDS.PRODUCT_ID;
  }

  return null;
}

// Build the canonical header map from a raw header row. Fails closed when a
// required column is missing or when an unknown header is encountered.
export function buildHeaderMap(rawHeaders) {
  if (!Array.isArray(rawHeaders)) fail('invalid_headers', 'headers must be an array');

  const map = Object.create(null);
  const seen = new Set();
  const unknown = [];

  for (const raw of rawHeaders) {
    const field = resolveHeader(raw);
    if (field == null) {
      unknown.push(String(raw ?? '').trim());
      continue;
    }
    if (seen.has(field)) fail('duplicate_column', `duplicate column for canonical field: ${field}`);
    seen.add(field);
    map[field] = raw;
  }

  if (unknown.length > 0) fail('unknown_headers', `headers are not part of the verified Shopee TH feed contract: ${unknown.join(', ')}`);

  for (const field of Object.values(SHOPEE_TH_FEED_FIELDS)) {
    if (!(field in map)) fail('missing_column', `required column is missing: ${field}`);
  }

  return Object.freeze(map);
}

// Normalize a raw row object into a canonical record. Validates required fields,
// applies type conversion, and returns a frozen record.
export function normalizeRow(rawRow) {
  if (!rawRow || typeof rawRow !== 'object') fail('invalid_row', 'row must be an object');
  
  const row = Object.create(null);
  const unknownKeys = [];
  
  for (const [key, value] of Object.entries(rawRow)) {
    const field = resolveHeader(key);
    if (field == null) {
      unknownKeys.push(key);
      continue;
    }
    
    switch (field) {
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_ID:
        row.productId = requireNonEmpty(value, 'product_id');
        break;
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_NAME:
        row.productName = requireNonEmpty(value, 'product_name');
        break;
      case SHOPEE_TH_FEED_FIELDS.PRICE:
        row.price = value;
        break;
      case SHOPEE_TH_FEED_FIELDS.COMMISSION_RATE:
        row.commissionRate = value;
        break;
      case SHOPEE_TH_FEED_FIELDS.SOLD:
        row.sold = parseSoldCount(value);
        break;
      case SHOPEE_TH_FEED_FIELDS.PRICE_MINOR_UNITS:
        row.priceMinorUnits = parsePriceToMinorUnits(value);
        break;
      case SHOPEE_TH_FEED_FIELDS.COMMISSION_AMOUNT_MINOR_UNITS:
        row.commissionAmountMinorUnits = parseCommissionAmountToMinorUnits(value);
        break;
      case SHOPEE_TH_FEED_FIELDS.COMMISSION_RATE_BPS:
        row.commissionRateBps = parseRateToBasisPoints(value);
        break;
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_URL:
        row.productUrl = requireHttpsUrl(value, 'product_url');
        break;
      case SHOPEE_TH_FEED_FIELDS.AFFILIATE_URL:
        row.affiliateUrl = requireHttpsUrl(value, 'affiliate_url');
        break;
      case SHOPEE_TH_FEED_FIELDS.CURRENCY:
        row.currency = requireNonEmpty(value, 'currency');
        break;
      case SHOPEE_TH_FEED_FIELDS.SCHEMA_VERSION:
        row.schemaVersion = requireNonEmpty(value, 'schema_version');
        break;
    }
  }
  
  if (unknownKeys.length > 0) {
    fail('unknown_headers', `unknown columns for canonical row: ${unknownKeys.join(', ')}`);
  }
  
  // Validate all required fields are present
  const requiredFields = Object.values(SHOPEE_TH_FEED_FIELDS);
  for (const field of requiredFields) {
    if (!(field in row)) {
      fail('missing_column', `required column is missing: ${field}`);
    }
  }
  
  return Object.freeze({
    tenantId: null, // Will be set by the repository
    productId: row.productId,
    productName: row.productName,
    priceMinorUnits: row.priceMinorUnits,
    price: row.price,
    commissionRateBps: row.commissionRateBps,
    commissionAmountMinorUnits: row.commissionAmountMinorUnits,
    sold: row.sold,
    currency: row.currency,
    productUrl: row.productUrl,
    affiliateUrl: row.affiliateUrl,
    schemaVersion: row.schemaVersion
  });
}

// Build the canonical header map from a raw header row. Fails closed when a
// required column is missing or when an unknown header is encountered.
export function buildHeaderMap(rawHeaders) {
  if (!Array.isArray(rawHeaders)) fail('invalid_headers', 'headers must be an array');

  const map = Object.create(null);
  const seen = new Set();
  const unknown = [];

  for (const raw of rawHeaders) {
    const field = resolveHeader(raw);
    if (field == null) {
      unknown.push(String(raw ?? '').trim());
      continue;
    }
    if (seen.has(field)) fail('duplicate_column', `duplicate column for canonical field: ${field}`);
    seen.add(field);
    map[field] = raw;
  }

  if (unknown.length > 0) fail('unknown_headers', `headers are not part of the verified Shopee TH feed contract: ${unknown.join(', ')}`);

  for (const field of Object.values(SHOPEE_TH_FEED_FIELDS)) {
    if (!(field in map)) fail('missing_column', `required column is missing: ${field}`);
  }

  return Object.freeze(map);
}