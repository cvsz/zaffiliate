import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShopeeThFeedHeaders, normalizeShopeeThFeedRow, parseShopeeThFeedCsv, parseShopeeThSoldCount, validateShopeeThFeedHeaders } from '../packages/adapters/src/shopee-th-feed.js';

test('Shopee TH feed headers accept BOM and fail closed on unknown/incomplete schema', () => {
  const headers = [...ShopeeThFeedHeaders];
  headers[0] = `\uFEFF${headers[0]}`;
  assert.deepEqual([...validateShopeeThFeedHeaders(headers)], ShopeeThFeedHeaders);
  assert.throws(() => validateShopeeThFeedHeaders(ShopeeThFeedHeaders.filter((header) => header !== 'คอมมิชชัน')), /missing headers: คอมมิชชัน/);
});

test('Shopee TH sold notation is deterministic for Thai units', () => {
  assert.equal(parseShopeeThSoldCount('900'), 900);
  assert.equal(parseShopeeThSoldCount('1.2พัน+'), 1200);
  assert.equal(parseShopeeThSoldCount('2หมื่น'), 20000);
  assert.equal(parseShopeeThSoldCount('3.5แสน'), 350000);
  assert.equal(parseShopeeThSoldCount('1.1ล้าน+'), 1100000);
  assert.throws(() => parseShopeeThSoldCount('เยอะมาก'), /unsupported format/);
});

test('Shopee TH row normalization preserves commission observation and source evidence without hard-coded rates', () => {
  const row = {
    'รหัสสินค้า': 'TH-123',
    'ชื่อสินค้า': 'สินค้า ทดสอบ',
    'ราคา': '฿1,299.50',
    'ขาย': '1.2พัน+',
    'ชื่อร้านค้า': 'ร้านทดสอบ',
    'อัตราค่าคอมมิชชัน': '12.5%',
    'คอมมิชชัน': '162.44',
    'ลิงก์สินค้า': 'https://shopee.co.th/product/123',
    'ลิงก์ข้อเสนอ': 'https://s.shopee.co.th/example'
  };
  const normalized = normalizeShopeeThFeedRow(row, {
    sourceTimestamp: '2026-09-17T00:00:00Z',
    sourceFilename: 'shopee-th-feed.csv',
    rowNumber: 2
  });
  assert.equal(normalized.platform, 'shopee');
  assert.equal(normalized.market, 'TH');
  assert.equal(normalized.productId, 'TH-123');
  assert.equal(normalized.price, 1299.5);
  assert.equal(normalized.soldCount, 1200);
  assert.equal(normalized.commission.observedRate, 0.125);
  assert.equal(normalized.commission.observedAmount, 162.44);
  assert.equal(normalized.commission.currency, 'THB');
  assert.equal(normalized.commission.status, 'observed');
  assert.equal(normalized.commission.observedAt, '2026-09-17T00:00:00.000Z');
  assert.equal(normalized.provenance.sourceTimestamp, '2026-09-17T00:00:00.000Z');
  assert.match(normalized.provenance.evidenceSha256, /^[0-9a-f]{64}$/);
  assert.equal(normalized.provenance.schemaVersion, 1);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.commission));
  assert.ok(Object.isFrozen(normalized.provenance));
});

test('Shopee TH normalization rejects malformed financial values, insecure URLs and missing source time', () => {
  const base = {
    'รหัสสินค้า': '1', 'ชื่อสินค้า': 'x', 'ราคา': '100', 'ขาย': '1', 'ชื่อร้านค้า': 'shop',
    'อัตราค่าคอมมิชชัน': '10%', 'คอมมิชชัน': '10',
    'ลิงก์สินค้า': 'https://shopee.co.th/x', 'ลิงก์ข้อเสนอ': 'https://s.shopee.co.th/x'
  };
  assert.throws(() => normalizeShopeeThFeedRow(base), /sourceTimestamp is required/);
  assert.throws(() => normalizeShopeeThFeedRow({ ...base, ราคา: '-1' }, { sourceTimestamp: '2026-09-17T00:00:00Z' }), /non-negative number/);
  assert.throws(() => normalizeShopeeThFeedRow({ ...base, 'อัตราค่าคอมมิชชัน': '101%' }, { sourceTimestamp: '2026-09-17T00:00:00Z' }), /between 0 and 100/);
  assert.throws(() => normalizeShopeeThFeedRow({ ...base, 'ลิงก์ข้อเสนอ': 'http://example.test/x' }, { sourceTimestamp: '2026-09-17T00:00:00Z' }), /https URL/);
});

test('Shopee TH CSV ingestion handles BOM, CRLF, commas and quoted newlines while preserving row provenance', () => {
  const csv = `\uFEFF${ShopeeThFeedHeaders.join(',')}\r\nTH-1,"สินค้า, รุ่น A",1299.50,1.2พัน+,"ร้าน\nทดสอบ",12.5%,162.44,https://shopee.co.th/product/1,https://s.shopee.co.th/a\r\n`;
  const rows = parseShopeeThFeedCsv(csv, { sourceTimestamp: '2026-09-19T03:00:00Z', sourceFilename: 'feed.csv' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productId, 'TH-1');
  assert.equal(rows[0].name, 'สินค้า, รุ่น A');
  assert.equal(rows[0].shopName, 'ร้าน\nทดสอบ');
  assert.equal(rows[0].commission.observedRate, 0.125);
  assert.equal(rows[0].commission.observedAmount, 162.44);
  assert.equal(rows[0].provenance.sourceFilename, 'feed.csv');
  assert.equal(rows[0].provenance.rowNumber, 2);
  assert.equal(rows[0].provenance.sourceTimestamp, '2026-09-19T03:00:00.000Z');
});

test('Shopee TH CSV ingestion fails closed on malformed rows and schema drift', () => {
  const valid = ShopeeThFeedHeaders.join(',');
  assert.throws(() => parseShopeeThFeedCsv(`${valid}\nTH-1,missing`, { sourceTimestamp: '2026-09-19T03:00:00Z' }), /row 2.*column count/i);
  assert.throws(() => parseShopeeThFeedCsv(`${valid},unexpected\n`, { sourceTimestamp: '2026-09-19T03:00:00Z' }), /missing headers|unsupported Shopee TH feed schema/i);
  assert.throws(() => parseShopeeThFeedCsv(`${valid}\n"unterminated`, { sourceTimestamp: '2026-09-19T03:00:00Z' }), /unterminated quoted field/i);
});
