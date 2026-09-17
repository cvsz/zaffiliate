// Canonical Shopee Thailand product-feed fixtures used by the normalizer
// tests. Headers are derived from the verified constants module so that the
// fixtures cannot drift from the contract.

import {
  SHOPEE_TH_PRODUCT_FEED_HEADERS,
  SHOPEE_TH_FEED_FIELDS
} from '../../packages/adapters/src/shopee-th-constants.js';

export const TH_HEADERS = Object.values(SHOPEE_TH_PRODUCT_FEED_HEADERS).concat(
  SHOPEE_TH_FEED_FIELDS.PRODUCT_ID
);

export const VALID_ROW = [
  '\u0E44\u0E17\u0E22\u0E2A\u0E32\u0E07\u0E44\u0E17\u0E22', // ผ้าทอ 2in1
  '123.50',
  '5 พัน',
  '\u0E40\u0E27\u0E25\u0E29\u0E49\u0E32\u0E19', // เวิลัย
  '10.00',
  '123.50',
  'https://shopee.th/product/123',
  'https://shopee.th/affiliate/abc',
  'SP001'
];

export const VALID_CSV = TH_HEADERS.join(',') + '\n' + VALID_ROW.join(',');

export const BOM_CSV = '\uFEFF' + VALID_CSV;

export const CRLF_CSV = TH_HEADERS.join(',') + '\r\n' + VALID_ROW.join(',') + '\r\n';

export const THAI_QUANTITY_CASES = [
  { input: '5 พัน', expected: 5000 },
  { input: '2.5 หมื่น', expected: 25000 },
  { input: '1 ล้าน', expected: 1000000 },
  { input: '100', expected: 100 },
  { input: '0', expected: 0 }
];