// Shopee Thailand Affiliate — verified product-feed contract.
//
// The Thai header strings below are transcribed from the canonical
// specification (docs/EXEC-INTERGRADETION-SHOPEE.md §4) using explicit
// Unicode code points so that no editor/encoding round-trip can drift the
// canonical mapping. Each constant is paired with its canonical field name.
//
// Source bytes were decoded as CP874 (the legacy Thai codepage used by the
// spec document). The recovered code points are stable UTF-8 and are the
// single source of truth for header recognition.

export const SHOPEE_TH_FEED_SCHEMA_VERSION = '1.0.0';

// Canonical field names. Frozen; never redefined by caller input.
export const SHOPEE_TH_FEED_FIELDS = Object.freeze({
  PRODUCT_NAME: 'product_name',
  PRICE: 'price',
  SOLD: 'sold',
  SHOP_NAME: 'shop_name',
  COMMISSION_RATE: 'commission_rate',
  COMMISSION_AMOUNT: 'commission_amount',
  PRODUCT_URL: 'product_url',
  AFFILIATE_URL: 'affiliate_url',
  PRODUCT_ID: 'product_id'
});

// Verified Thai headers (CP874-decoded from spec §4).
//   ชื่อสินค้า  = product name
//   ราคา       = price
//   linky       = sold
//   ชื่อร้านค้า  = shop name
//   อัตราค่า commision = commission rate
//   commision   = commission amount
//   ลิงก์สินค้า  = product URL
//   ลิงก์ข้อoffer = affiliate/offer URL
export const SHOPEE_TH_PRODUCT_FEED_HEADERS = Object.freeze({
  product_name: '\u0E0A\u0E37\u0E48\u0E2D\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32',
  price: '\u0E23\u0E32\u0E04\u0E32',
  sold: '\u0E02\u0E32\u0E22',
  shop_name: '\u0E0A\u0E37\u0E48\u0E2D\u0E23\u0E49\u0E32\u0E19\u0E04\u0E49\u0E32',
  commission_rate: '\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E04\u0E48\u0E32\u0E04\u0E2D\u0E21\u0E21\u0E34\u0E0A\u0E0A\u0E31\u0E19',
  commission_amount: '\u0E04\u0E2D\u0E21\u0E21\u0E34\u0E0A\u0E0A\u0E31\u0E19',
  product_url: '\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32',
  affiliate_url: '\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E02\u0E49\u0E2D\u0E40\u0E2A\u0E19\u0E2D'
});

// The product-id column is required by the normalization contract but its
// exact Thai header is NOT verified in the specification. We therefore accept
// a small, explicit set of known aliases and fail closed when none is present.
// This keeps the parser deterministic: no guessing, no silent coercion.
export const SHOPEE_TH_PRODUCT_ID_ALIASES = Object.freeze([
  'product_id',
  'productID',
  'product id',
  'ProductID',
  'Product Id'
]);

// Thai quantity notation observed in Shopee TH feeds. Values are parsed
// multiplicatively and combined with any explicit numeric prefix.
//   พัน     = 1,000
//   หมื่น    = 10,000
//    ล้าน    = 1,000,000
export const SHOPEE_TH_QUANTITY_WORDS = Object.freeze({
  '\u0E1E\u0E31\u0E19': 1_000,     // พัน
  '\u0E2B\u0E21\u0E37\u0E48\u0E19': 10_000,    // หมื่น
  '\u0E41\u0E2A\u0E19': 100_000,   //  Sacan
  '\u0E25\u0E49\u0E32\u0E19': 1_000_000   // ล้าน
});

// Canonical money/percentage scale. Prices and commissions are stored as
// minor-unit (integer) representations; rates are stored as basis points.
export const SHOPEE_TH_MONEY_MINOR_UNITS = 2;   // ฿1.00 = 100 minor units
export const SHOPEE_TH_RATE_BASIS_POINTS = 10_000; // 1.00 = 10000 bps

// BOM + whitespace normalization. Thai feeds frequently arrive as UTF-8 with
// a leading BOM and CRLF line endings.
export const UTF8_BOM = '\uFEFF';

// ---------------------------------------------------------------------------
// Shopee Thailand affiliate link contract (verified from Shopee TH Help
// Center: "การสร้างลิงก์สั้นแบบกำหนดเอง", article 172214).
//
// Canonical redirect URL:
//   https://s.shopee.co.th/an_redir?origin_link=<URL-encoded landing page>
//     ?&affiliate_id={affiliate_id}&sub_id={sub-publisher id}-{network click
//     id}-{referral source}-{custom value}-{custom value}
//
// The sub_id MUST contain exactly five dash-separated segments. Shopee
// rewrites the final landing page to carry utm_source=an_{affiliate_id},
// utm_content={sub_id}, utm_medium=affiliates and a shop-set utm_term.
// ---------------------------------------------------------------------------

export const SHOPEE_TH_REDIRECT_HOST = 's.shopee.co.th';
export const SHOPEE_TH_REDIRECT_PATH = '/an_redir';
export const SHOPEE_TH_ORIGIN_LINK_PARAM = 'origin_link';
export const SHOPEE_TH_AFFILIATE_ID_PARAM = 'affiliate_id';
export const SHOPEE_TH_SUB_ID_PARAM = 'sub_id';
export const SHOPEE_TH_SUB_ID_SEGMENTS = 5;
export const SHOPEE_TH_SUB_ID_SEGMENT_SEPARATOR = '-';
export const SHOPEE_TH_SUB_ID_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
export const SHOPEE_TH_AFFILIATE_ID_PATTERN = /^\d+$/;
export const SHOPEE_TH_UTM_SOURCE_PREFIX = 'an_';
export const SHOPEE_TH_UTM_SOURCE_PARAM = 'utm_source';
export const SHOPEE_TH_UTM_CONTENT_PARAM = 'utm_content';
export const SHOPEE_TH_UTM_MEDIUM_PARAM = 'utm_medium';
export const SHOPEE_TH_UTM_MEDIUM_VALUE = 'affiliates';
export const SHOPEE_TH_UTM_TERM_PARAM = 'utm_term';
export const SHOPEE_TH_UTM_CAMPAIGN_PARAM = 'utm_campaign';
export const SHOPEE_TH_UTM_CAMPAIGN_VALUE = '-';