import { createHash, createHmac } from 'node:crypto';
import { assertValidObjectKey } from './index.js';

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now) {
  const date = now instanceof Date ? now : new Date(now);
  const compact = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amz: compact, date: compact.slice(0, 8) };
}

export function createS3Driver({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'us-east-1', fetchImpl = null } = {}) {
  for (const [field, value] of Object.entries({ endpoint, bucket, accessKeyId, secretAccessKey })) {
    if (!String(value ?? '').trim()) throw new Error(`${field} is required`);
  }
  const doFetch = fetchImpl ?? fetch;
  const base = String(endpoint).replace(/\/+$/, '');

  function signedRequest(method, key, body = null, { now = new Date() } = {}) {
    const safeKey = assertValidObjectKey(key);
    const url = `${base}/${bucket}/${safeKey}`;
    const payloadHash = sha256Hex(body ?? '');
    const { amz, date } = amzDate(now);
    const headers = {
      host: new URL(url).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz
    };
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('');
    const canonicalRequest = [
      method,
      `/${bucket}/${safeKey}`,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');
    const scope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return {
      url,
      options: {
        method,
        headers: { ...headers, authorization }
      }
    };
  }

  async function put(key, body, contentType, { now = new Date() } = {}) {
    if (!Buffer.isBuffer(body)) throw new TypeError('body must be a Buffer');
    const { url, options } = signedRequest('PUT', key, body, { now });
    options.headers['content-type'] = contentType ?? 'application/octet-stream';
    const response = await doFetch(url, options);
    if (!response.ok) throw new Error(`s3 put failed with ${response.status}`);
    return { stored: true, key, bytes: body.length, etag: response.headers?.get?.('etag') ?? null };
  }

  async function get(key, { now = new Date() } = {}) {
    const { url, options } = signedRequest('GET', key, null, { now });
    const response = await doFetch(url, options);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`s3 get failed with ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { body: buffer, key };
  }

  return Object.freeze({ put, get });
}
