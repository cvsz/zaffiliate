import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOPEE_TH_FEED_SCHEMA_VERSION,
  SHOPEE_TH_FEED_FIELDS,
  SHOPEE_TH_PRODUCT_FEED_HEADERS,
  SHOPEE_TH_QUANTITY_WORDS,
  SHOPEE_TH_MONEY_MINOR_UNITS,
  SHOPEE_TH_RATE_BASIS_POINTS
} from '../packages/adapters/src/shopee-th-constants.js';
import { parseSoldCount, parsePriceToMinorUnits, parseRateToBasisPoints, buildHeaderMap, normalizeRow, splitCsv, parseShopeeThFeed, ShopeeThFeedError } from '../packages/adapters/src/shopee-th-normalizer.js';
import { TH_HEADERS, VALID_ROW, VALID_CSV, BOM_CSV, CRLF_CSV, THAI_QUANTITY_CASES } from './fixtures/shopee-th-feed.js';

test('verified Thai headers map to canonical field names', () => {
  assert.equal(SHOPEE_TH_PRODUCT_FEED_HEADERS.product_name, '\u0E0A\u0E37\u0E48\u0E2D\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32');
  assert.equal(SHOPEE_TH_PRODUCT_FEED_HEADERS.price, '\u0E23\u0E32\u0E04\u0E32');
  assert.equal(SHOPEE_TH_PRODUCT_FEED_HEADERS.sold, '\u0E02\u0E32\u0E22');
  assert.equal(Object.keys(SHOPEE_TH_PRODUCT_FEED_HEADERS).length, 8);
  assert.equal(SHOPEE_TH_MONEY_MINOR_UNITS, 2);
  assert.equal(SHOPEE_TH_RATE_BASIS_POINTS, 10000);
  assert.equal(SHOPEE_TH_FEED_SCHEMA_VERSION, '1.0.0');
});

test('Thai quantity words parse multiplicatively', () => {
  for (const { input, expected } of THAI_QUANTITY_CASES) {
    assert.equal(parseSoldCount(input), expected, `input: ${input}`);
  }
  assert.throws(() => parseSoldCount(''), (e) => e.code === 'field_required');
  assert.throws(() => parseSoldCount('99 ศูนย์'), (e) => e.code === 'unknown_quantity_word');
});

test('price and rate parse to integer minor units / basis points', () => {
  assert.equal(parsePriceToMinorUnits('123.50'), 12350);
  assert.equal(parsePriceToMinorUnits('0'), 0);
  assert.equal(parseRateToBasisPoints('10.00'), 100000);
  assert.throws(() => parsePriceToMinorUnits('abc'), (e) => e.code === 'invalid_decimal');
  assert.throws(() => parsePriceToMinorUnits('-5'), (e) => e.code === 'invalid_decimal');
});

test('buildHeaderMap rejects unknown headers and missing columns', () => {
  const map = buildHeaderMap(TH_HEADERS);
  assert.equal(map[SHOPEE_TH_FEED_FIELDS.PRODUCT_ID], 'product_id');
  assert.throws(() => buildHeaderMap(['unknown_header']), (e) => e.code === 'unknown_headers');
  assert.throws(() => buildHeaderMap([TH_HEADERS[0]]), (e) => e.code === 'missing_column');
});

test('normalizeRow produces a frozen canonical record', () => {
  const row = {};
  TH_HEADERS.forEach((header, index) => { row[header] = VALID_ROW[index]; });
  const record = normalizeRow(row);
  assert.ok(Object.isFrozen(record));
  assert.equal(record.schemaVersion, '1.0.0');
  assert.equal(record.currency, 'THB');
  assert.equal(record.priceMinorUnits, 12350);
  assert.equal(record.commissionRateBps, 100000);
  assert.equal(record.commissionAmountMinorUnits, 12350);
  assert.equal(record.sold, 5000);
  assert.equal(record.productUrl, 'https://shopee.th/product/123');
  assert.equal(record.affiliateUrl, 'https://shopee.th/affiliate/abc');
  assert.throws(() => normalizeRow({}), (e) => e.code === 'missing_column');
});

test('normalizeRow rejects invalid URLs and money', () => {
  const bad = {};
  TH_HEADERS.forEach((header, index) => { bad[header] = VALID_ROW[index]; });
  bad[TH_HEADERS[6]] = 'http://example.com';
  assert.throws(() => normalizeRow(bad), (e) => e.code === 'invalid_url');
});

test('splitCsv handles quoted fields, BOM and CRLF', () => {
  const rows = splitCsv(VALID_CSV);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 9);
  assert.equal(rows[1][0], '\u0E44\u0E17\u0E22\u0E2A\u0E32\u0E07\u0E44\u0E17\u0E22');

  const bomRows = splitCsv(BOM_CSV);
  assert.equal(bomRows[0][8], 'product_id');

  const crlfRows = splitCsv(CRLF_CSV);
  assert.equal(crlfRows.length, 2);
});

test('parseShopeeThFeed accepts a valid feed and rejects malformed rows', () => {
  const result = parseShopeeThFeed(VALID_CSV);
  assert.equal(result.platform, 'shopee');
  assert.equal(result.region, 'TH');
  assert.equal(result.rows.length, 1);
  assert.equal(result.counts.accepted, 1);
  assert.equal(result.counts.rejected, 0);
  assert.ok(Object.isFrozen(result));

  const mixed = TH_HEADERS.join(',') + '\n' + VALID_ROW.join(',') + '\n' + TH_HEADERS.join(',');
  const mixedResult = parseShopeeThFeed(mixed);
  assert.equal(mixedResult.rows.length, 1);
  assert.equal(mixedResult.rejected.length, 1);
  assert.equal(mixedResult.rejected[0].code, 'invalid_decimal');
});

test('parseShopeeThFeed fails closed on empty or header-only feeds', () => {
  assert.throws(() => parseShopeeThFeed(''), (e) => e.code === 'empty_feed');
  assert.throws(() => parseShopeeThFeed(TH_HEADERS.join(',')), (e) => e.code === 'empty_feed');
  assert.throws(() => parseShopeeThFeed('not,a,valid,feed,at,all,please,ignore,me'), (e) => e.code === 'unknown_headers');
});

test('ShopeeThFeedError carries a code and frozen details', () => {
  const error = new ShopeeThFeedError('boom', 'SHOPEE_TH_FEED_ERROR', { row: 3 });
  assert.equal(error.name, 'ShopeeThFeedError');
  assert.equal(error.code, 'SHOPEE_TH_FEED_ERROR');
  assert.ok(Object.isFrozen(error.details));
});