import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceToMinorUnits,
  parseRateToBasisPoints,
  parseSoldCount,
  splitCsv
} from '../packages/adapters/src/shopee-th-normalizer.js';

test('Shopee TH normalizer accepts observed Thai feed financial formats without assuming commission', () => {
  assert.equal(parsePriceToMinorUnits('฿1,299.50'), 129950);
  assert.equal(parseRateToBasisPoints('12.5%'), 1250);
  assert.equal(parseSoldCount('1.2พัน+'), 1200);
  assert.equal(parseSoldCount('3.5แสน'), 350000);
});

test('Shopee TH CSV parser preserves BOM, CRLF and quoted embedded newlines', () => {
  assert.deepEqual(splitCsv('\uFEFFa,b\r\n"x\ny",z\r\n'), [['a', 'b'], ['x\ny', 'z']]);
});

test('Shopee TH CSV parser fails closed on malformed quoting', () => {
  assert.throws(() => splitCsv('a,b\n"unterminated,x'), /unterminated quoted field/);
  assert.throws(() => splitCsv('a,b\nabc"def,x'), /quote must start at field boundary/);
});

test('Shopee TH rate parser rejects ambiguous bare rates and impossible percentages', () => {
  assert.throws(() => parseRateToBasisPoints('0.125'), /percentage/);
  assert.throws(() => parseRateToBasisPoints('101%'), /between 0 and 100/);
});
