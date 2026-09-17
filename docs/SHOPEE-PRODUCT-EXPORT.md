# Shopee Thailand Product Export — verified fixture pointer

Source: real Shopee Thailand Affiliate product export
URL: https://drive.google.com/file/d/1rjHiN2tupwTYd_raLi7GEHvpOcnM69qx/view

## Role

This file is the **verified external fixture** for the Shopee Thailand Affiliate
product-feed contract. It is the artifact that confirms the header mapping in
`packages/adapters/src/shopee-th-constants.js` is real, not invented.

## What it validates

- The nine verified Thai headers in `SHOPEE_TH_PRODUCT_FEED_HEADERS`.
- The Thai quantity-word parsing in `SHOPEE_TH_QUANTITY_WORDS`.
- The money (minor units) and rate (basis points) scales.
- BOM / CRLF / quoted-field CSV handling.

## How to use it

1. Download the export.
2. Confirm the header row matches `SHOPEE_TH_PRODUCT_FEED_HEADERS` exactly.
3. Run `node --test test/shopee-th-feed.test.js` against the real file.
4. If the real headers differ from the constants, the constants are wrong —
   fix them and re-verify. Never silently widen acceptance.

## Gated by this fixture

The product-feed parser (SLICE 1) is complete only while this fixture confirms
the contract. The Click Report and Order Report parsers (SLICES 6 and 7) remain
**explicitly gated** until their own real export fixtures are available; they
must not be implemented by guessing column meanings.