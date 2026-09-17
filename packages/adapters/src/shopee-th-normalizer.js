// Shopee Thailand Affiliate — verified product-feed contract.
// Deterministic normalization; unknown schemas and malformed CSV fail closed.

import {
  SHOPEE_TH_FEED_SCHEMA_VERSION,
  SHOPEE_TH_FEED_FIELDS,
  SHOPEE_TH_PRODUCT_FEED_HEADERS,
  SHOPEE_TH_PRODUCT_ID_ALIASES,
  SHOPEE_TH_QUANTITY_WORDS,
  SHOPEE_TH_MONEY_MINOR_UNITS,
  SHOPEE_TH_RATE_BASIS_POINTS
} from './shopee-th-constants.js';

export class ShopeeThFeedError extends Error {
  constructor(message, code = 'SHOPEE_TH_FEED_ERROR', details = null) {
    super(message); this.name = 'ShopeeThFeedError'; this.code = code;
    this.details = details == null ? null : Object.freeze(details);
  }
}
function fail(code, message, details = null) { throw new ShopeeThFeedError(message, code, details); }
function requireNonEmpty(value, label) { const text = String(value ?? '').trim(); if (!text) fail('field_required', `${label} is required`); return text; }
function normalizedNumberText(value, label, { percent = false } = {}) {
  let text = String(value ?? '').trim();
  if (percent) { if (!text.endsWith('%')) fail('invalid_decimal', `${label} must be a percentage, got: ${JSON.stringify(value)}`); text = text.slice(0, -1).trim(); }
  text = text.replace(/^฿\s*/, '').replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) fail('invalid_decimal', `${label} must be numeric, got: ${JSON.stringify(value)}`);
  return Number(text);
}
function requirePositiveDecimal(value, label) { const n = normalizedNumberText(value, label); if (n < 0) fail('invalid_decimal', `${label} must be non-negative, got: ${JSON.stringify(value)}`); return n; }
function requireHttpsUrl(value, label) { const text = requireNonEmpty(value, label); let url; try { url = new URL(text); } catch { fail('invalid_url', `${label} must be a valid URL`); } if (url.protocol !== 'https:') fail('invalid_url', `${label} must be an https URL`); return text; }

export function parseSoldCount(value) {
  const text = String(value ?? '').trim().replace(/\+$/, '');
  if (!text) fail('field_required', 'sold is required');
  const match = text.match(/^\s*(\d+(?:\.\d+)?)?\s*([\u0E00-\u0E7F]+)?\s*$/);
  if (!match) fail('invalid_quantity', `sold notation is not parseable: ${JSON.stringify(value)}`);
  const numericPart = match[1] == null ? null : Number(match[1]); const wordPart = match[2] ?? null;
  if (wordPart == null) { if (numericPart == null || !Number.isInteger(numericPart)) fail('invalid_quantity', 'sold must be a non-negative integer'); return numericPart; }
  const multiplier = SHOPEE_TH_QUANTITY_WORDS[wordPart]; if (multiplier == null) fail('unknown_quantity_word', `unknown Thai quantity word: ${JSON.stringify(wordPart)}`);
  const result = (numericPart ?? 1) * multiplier; if (!Number.isInteger(result) || result < 0) fail('invalid_quantity', 'sold notation is invalid'); return result;
}
export function parsePriceToMinorUnits(value) { const minor = Math.round(requirePositiveDecimal(value, 'price') * 10 ** SHOPEE_TH_MONEY_MINOR_UNITS); if (!Number.isSafeInteger(minor)) fail('money_overflow', 'price overflows minor units'); return minor; }
export function parseRateToBasisPoints(value) { const percent = normalizedNumberText(value, 'commission_rate', { percent: true }); if (percent < 0 || percent > 100) fail('invalid_decimal', 'commission_rate must be between 0 and 100 percent'); return Math.round((percent / 100) * SHOPEE_TH_RATE_BASIS_POINTS); }
export function parseCommissionAmountToMinorUnits(value) { const minor = Math.round(requirePositiveDecimal(value, 'commission_amount') * 10 ** SHOPEE_TH_MONEY_MINOR_UNITS); if (!Number.isSafeInteger(minor)) fail('money_overflow', 'commission amount overflows minor units'); return minor; }

const HEADER_TO_FIELD = Object.fromEntries(Object.entries(SHOPEE_TH_PRODUCT_FEED_HEADERS).map(([field, header]) => [header, field]));
export function resolveHeader(rawHeader) { const header = String(rawHeader ?? '').replace(/^\uFEFF/, '').trim(); if (!header) return null; return HEADER_TO_FIELD[header] ?? (SHOPEE_TH_PRODUCT_ID_ALIASES.includes(header) ? SHOPEE_TH_FEED_FIELDS.PRODUCT_ID : null); }

export function normalizeRow(rawRow) {
  if (!rawRow || typeof rawRow !== 'object') fail('invalid_row', 'row must be an object');
  const row = Object.create(null); const unknownKeys = [];
  for (const [key, value] of Object.entries(rawRow)) {
    const field = resolveHeader(key); if (field == null) { unknownKeys.push(key); continue; }
    switch (field) {
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_ID: row.productId = requireNonEmpty(value, 'product_id'); break;
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_NAME: row.productName = requireNonEmpty(value, 'product_name'); break;
      case SHOPEE_TH_FEED_FIELDS.PRICE: row.priceMinorUnits = parsePriceToMinorUnits(value); row.price = value; break;
      case SHOPEE_TH_FEED_FIELDS.COMMISSION_RATE: row.commissionRateBps = parseRateToBasisPoints(value); row.commissionRate = value; break;
      case SHOPEE_TH_FEED_FIELDS.COMMISSION_AMOUNT: row.commissionAmountMinorUnits = parseCommissionAmountToMinorUnits(value); break;
      case SHOPEE_TH_FEED_FIELDS.SOLD: row.sold = parseSoldCount(value); break;
      case SHOPEE_TH_FEED_FIELDS.SHOP_NAME: row.shopName = requireNonEmpty(value, 'shop_name'); break;
      case SHOPEE_TH_FEED_FIELDS.PRODUCT_URL: row.productUrl = requireHttpsUrl(value, 'product_url'); break;
      case SHOPEE_TH_FEED_FIELDS.AFFILIATE_URL: row.affiliateUrl = requireHttpsUrl(value, 'affiliate_url'); break;
    }
  }
  if (unknownKeys.length) fail('unknown_headers', `unknown columns for canonical row: ${unknownKeys.join(', ')}`);
  for (const key of ['productId','productName','priceMinorUnits','commissionRateBps','commissionAmountMinorUnits','sold','productUrl','affiliateUrl']) if (!(key in row)) fail('missing_column', `required column is missing: ${key}`);
  return Object.freeze({ tenantId: null, productId: row.productId, productName: row.productName, priceMinorUnits: row.priceMinorUnits, price: row.price, commissionRateBps: row.commissionRateBps, commissionAmountMinorUnits: row.commissionAmountMinorUnits, sold: row.sold, currency: 'THB', productUrl: row.productUrl, affiliateUrl: row.affiliateUrl, schemaVersion: SHOPEE_TH_FEED_SCHEMA_VERSION });
}

export function splitCsv(csv) {
  const text = String(csv ?? ''); if (!text.trim()) return [];
  const rows=[]; let row=[], field='', inQuotes=false, i=0;
  while (i < text.length) { const ch=text[i], next=text[i+1];
    if (inQuotes) { if (ch==='"') { if (next==='"') { field+='"'; i+=2; continue; } inQuotes=false; i++; continue; } field+=ch; i++; continue; }
    if (ch==='"') { if (field.length) fail('malformed_csv','quote must start at field boundary'); inQuotes=true; i++; }
    else if (ch===',') { row.push(field); field=''; i++; }
    else if (ch==='\r' || ch==='\n') { if (ch==='\r' && next==='\n') i++; row.push(field); rows.push(row); row=[]; field=''; i++; }
    else { field+=ch; i++; }
  }
  if (inQuotes) fail('malformed_csv', 'unterminated quoted field');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.replace(/^\uFEFF/, '')));
}

export function parseShopeeThFeed(csv) {
  const rows=splitCsv(csv); if (!rows.length) fail('empty_feed','feed is empty'); const headerRow=rows[0].map(h=>String(h??'').trim()); buildHeaderMap(headerRow); if (rows.length<=1) fail('empty_feed','feed has no data rows');
  const records=[], rejected=[];
  for (let i=1;i<rows.length;i++) { const raw=rows[i]; if (raw.every(c=>String(c??'').trim()==='')) continue; if (raw.length!==headerRow.length) { rejected.push({row:i+1,code:'malformed_row',message:'column count does not match header'}); continue; } const canonical={}; headerRow.forEach((header,index)=>{canonical[header]=raw[index];}); try { records.push(normalizeRow(canonical)); } catch(error) { rejected.push({row:i+1,code:error.code??'SHOPEE_TH_FEED_ERROR',message:error.message}); } }
  return Object.freeze({platform:'shopee',region:'TH',schemaVersion:SHOPEE_TH_FEED_SCHEMA_VERSION,rows:records,counts:{accepted:records.length,rejected:rejected.length,total:rows.length-1},rejected:Object.freeze(rejected)});
}
export function buildHeaderMap(rawHeaders) { if (!Array.isArray(rawHeaders)) fail('invalid_headers','headers must be an array'); const map=Object.create(null), seen=new Set(), unknown=[]; for(const raw of rawHeaders){const field=resolveHeader(raw); if(field==null){unknown.push(String(raw??'').trim());continue;} if(seen.has(field)) fail('duplicate_column',`duplicate column for canonical field: ${field}`); seen.add(field); map[field]=raw;} if(unknown.length) fail('unknown_headers',`headers are not part of the verified Shopee TH feed contract: ${unknown.join(', ')}`); for(const field of Object.values(SHOPEE_TH_FEED_FIELDS)) if(!(field in map)) fail('missing_column',`required column is missing: ${field}`); return Object.freeze(map); }
