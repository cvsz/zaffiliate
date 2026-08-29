import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrlValidator, SSRF_BLOCKED } from '../packages/security/src/url-validation.js';
import { createTransportBoundary } from '../packages/adapters/src/transport-boundary.js';

const defaultValidator = createUrlValidator();
const ssrfValidator = createUrlValidator({ allowedSchemes: ['https', 'http'], blockPrivateRanges: true });

test('rejects private IP patterns - 127.x', () => {
  assert.throws(() => ssrfValidator.validate('https://127.0.0.1/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://127.255.255.255/path'), { code: SSRF_BLOCKED });
});

test('rejects private IP patterns - 10.x', () => {
  assert.throws(() => ssrfValidator.validate('https://10.0.0.1/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://10.255.255.255/path'), { code: SSRF_BLOCKED });
});

test('rejects private IP patterns - 192.168.x', () => {
  assert.throws(() => ssrfValidator.validate('https://192.168.1.1/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://192.168.255.255/path'), { code: SSRF_BLOCKED });
});

test('rejects private IP patterns - 172.16-31.x', () => {
  assert.throws(() => ssrfValidator.validate('https://172.16.0.1/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://172.31.255.255/path'), { code: SSRF_BLOCKED });
});

test('allows public IPs outside private ranges', () => {
  assert.deepEqual(ssrfValidator.validate('https://172.32.0.1/path'), Object.freeze({ allowed: true, host: '172.32.0.1', protocol: 'https' }));
  assert.deepEqual(ssrfValidator.validate('https://172.15.255.255/path'), Object.freeze({ allowed: true, host: '172.15.255.255', protocol: 'https' }));
});

test('rejects localhost and ::1', () => {
  assert.throws(() => ssrfValidator.validate('https://localhost/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://localhost:8080/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://[::1]/path'), { code: SSRF_BLOCKED });
});

test('rejects link-local 169.254.x.x', () => {
  assert.throws(() => ssrfValidator.validate('https://169.254.1.1/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://169.254.169.254/path'), { code: SSRF_BLOCKED });
});

test('rejects hosts with .local and .internal suffixes', () => {
  assert.throws(() => ssrfValidator.validate('https://foo.internal/path'), { code: SSRF_BLOCKED });
  assert.throws(() => ssrfValidator.validate('https://bar.local/path'), { code: SSRF_BLOCKED });
});

test('allows public hosts', () => {
  const result = ssrfValidator.validate('https://example.com/path');
  assert.equal(result.allowed, true);
  assert.equal(result.host, 'example.com');
  assert.equal(result.protocol, 'https');
});

test('rejects non-https scheme by default', () => {
  assert.throws(() => defaultValidator.validate('http://example.com/path'), { code: 'SCHEME_BLOCKED' });
  assert.throws(() => defaultValidator.validate('ftp://example.com/path'), { code: 'SCHEME_BLOCKED' });
});

test('rejects non-string input', () => {
  assert.throws(() => ssrfValidator.validate(123), TypeError);
  assert.throws(() => ssrfValidator.validate(null), TypeError);
  assert.throws(() => ssrfValidator.validate(undefined), TypeError);
  assert.throws(() => ssrfValidator.validate({}), TypeError);
  assert.throws(() => ssrfValidator.validate(''), TypeError);
});

test('allows non-https when configured', () => {
  const validator = createUrlValidator({ allowedSchemes: ['https', 'http'], blockPrivateRanges: true });
  const result = validator.validate('http://example.com/path');
  assert.equal(result.allowed, true);
  assert.equal(result.protocol, 'http');
});

test('allowedHosts whitelist blocks unlisted hosts', () => {
  const validator = createUrlValidator({ allowedHosts: ['api.example.com'], blockPrivateRanges: true });
  assert.deepEqual(validator.validate('https://api.example.com/path'), Object.freeze({ allowed: true, host: 'api.example.com', protocol: 'https' }));
  assert.throws(() => validator.validate('https://other.com/path'), { code: 'HOST_NOT_ALLOWED' });
});

test('allowedHosts wildcard *.example.com allows subdomains', () => {
  const validator = createUrlValidator({ allowedHosts: ['*.example.com'], blockPrivateRanges: true });
  assert.deepEqual(validator.validate('https://foo.example.com/path'), Object.freeze({ allowed: true, host: 'foo.example.com', protocol: 'https' }));
  assert.deepEqual(validator.validate('https://example.com/path'), Object.freeze({ allowed: true, host: 'example.com', protocol: 'https' }));
  assert.throws(() => validator.validate('https://other.com/path'), { code: 'HOST_NOT_ALLOWED' });
});

test('sensitive body keys blocked by transport boundary', () => {
  const boundary = createTransportBoundary({ urlValidator: ssrfValidator });
  assert.throws(() => boundary.request({ method: 'GET', url: 'https://example.com', body: { secret: 'x' } }), { code: 'sensitive_body_blocked' });
  assert.throws(() => boundary.request({ method: 'GET', url: 'https://example.com', body: { token: 'x' } }), { code: 'sensitive_body_blocked' });
  assert.throws(() => boundary.request({ method: 'GET', url: 'https://example.com', body: { password: 'x' } }), { code: 'sensitive_body_blocked' });
  assert.throws(() => boundary.request({ method: 'GET', url: 'https://example.com', body: { authorization: 'x' } }), { code: 'sensitive_body_blocked' });
});

test('transport boundary allows non-sensitive body', () => {
  const boundary = createTransportBoundary({ urlValidator: ssrfValidator });
  const result = boundary.request({ method: 'GET', url: 'https://example.com', body: { foo: 'bar' } });
  assert.equal(result.status, 200);
});

test('transport boundary redacts sensitive headers', () => {
  const boundary = createTransportBoundary({ urlValidator: ssrfValidator });
  const headers = { authorization: 'Bearer secret', cookie: 'sid=abc', 'x-api-key': 'key123', 'content-type': 'application/json' };
  const result = boundary.request({ method: 'GET', url: 'https://example.com', headers });
  assert.equal(result.headers['authorization'], '[REDACTED]');
  assert.equal(result.headers['cookie'], '[REDACTED]');
  assert.equal(result.headers['x-api-key'], '[REDACTED]');
  assert.equal(result.headers['content-type'], 'application/json');
});

test('transport boundary enforces validation before request', () => {
  const boundary = createTransportBoundary({ urlValidator: defaultValidator });
  assert.throws(() => boundary.request({ method: 'GET', url: 'http://localhost/path' }), { code: 'SCHEME_BLOCKED' });
});
