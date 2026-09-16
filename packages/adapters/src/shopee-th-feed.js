import { createHash } from 'node:crypto';

export const ShopeeThFeedHeaders = Object.freeze([
  'รหัสสินค้า',
  'ชื่อสินค้า',
  'ราคา',
  'ขาย',
  'ชื่อร้านค้า',
  'อัตราค่าคอมมิชชัน',
  'คอมมิชชัน',
  'ลิงก์สินค้า',
  'ลิงก์ข้อเสนอ'
]);

function text(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function decimal(value, name) {
  const normalized = text(value, name).replace(/,/g, '').replace(/^[฿\s]+/, '').replace(/\s*บาท$/, '');
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number`);
  return number;
}

function percentage(value, name) {
  const normalized = text(value, name).replace(/%$/, '').trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${name} must be a percentage between 0 and 100`);
  return number / 100;
}

export function parseShopeeThSoldCount(value) {
  const raw = text(value, 'ขาย').replace(/,/g, '').replace(/\s+/g, '');
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)(พัน|หมื่น|แสน|ล้าน)?(?:\+)?$/);
  if (!match) throw new Error('ขาย has unsupported format');
  const multipliers = { พัน: 1_000, หมื่น: 10_000, แสน: 100_000, ล้าน: 1_000_000 };
  return Math.floor(Number(match[1]) * (multipliers[match[2]] ?? 1));
}

function httpsUrl(value, name) {
  let url;
  try { url = new URL(text(value, name)); } catch { throw new Error(`${name} must be a valid URL`); }
  if (url.protocol !== 'https:') throw new Error(`${name} must be an https URL`);
  return url.toString();
}

export function validateShopeeThFeedHeaders(headers) {
  const normalized = headers.map((header, index) => index === 0 ? String(header).replace(/^\uFEFF/, '').trim() : String(header).trim());
  const missing = ShopeeThFeedHeaders.filter((header) => !normalized.includes(header));
  if (missing.length) throw new Error(`unsupported Shopee TH feed schema; missing headers: ${missing.join(', ')}`);
  return Object.freeze(normalized);
}

export function normalizeShopeeThFeedRow(row, { sourceTimestamp, sourceFilename = null, rowNumber = null } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('row must be an object');
  const observedAt = new Date(text(sourceTimestamp, 'sourceTimestamp'));
  if (Number.isNaN(observedAt.getTime())) throw new Error('sourceTimestamp must be an ISO-8601 timestamp');

  const productId = text(row['รหัสสินค้า'], 'รหัสสินค้า');
  const productUrl = httpsUrl(row['ลิงก์สินค้า'], 'ลิงก์สินค้า');
  const affiliateUrl = httpsUrl(row['ลิงก์ข้อเสนอ'], 'ลิงก์ข้อเสนอ');
  const evidence = JSON.stringify(ShopeeThFeedHeaders.map((header) => [header, String(row[header] ?? '')]));

  return Object.freeze({
    platform: 'shopee',
    market: 'TH',
    productId,
    name: text(row['ชื่อสินค้า'], 'ชื่อสินค้า'),
    shopName: text(row['ชื่อร้านค้า'], 'ชื่อร้านค้า'),
    price: decimal(row['ราคา'], 'ราคา'),
    soldCount: parseShopeeThSoldCount(row['ขาย']),
    productUrl,
    affiliateUrl,
    commission: Object.freeze({
      observedRate: percentage(row['อัตราค่าคอมมิชชัน'], 'อัตราค่าคอมมิชชัน'),
      observedAmount: decimal(row['คอมมิชชัน'], 'คอมมิชชัน'),
      currency: 'THB',
      observedAt: observedAt.toISOString(),
      status: 'observed'
    }),
    provenance: Object.freeze({
      sourceType: 'shopee_th_affiliate_feed',
      sourceFilename: sourceFilename == null ? null : text(sourceFilename, 'sourceFilename'),
      sourceTimestamp: observedAt.toISOString(),
      rowNumber: rowNumber == null ? null : Number(rowNumber),
      evidenceSha256: createHash('sha256').update(evidence).digest('hex'),
      schemaVersion: 1
    })
  });
}
