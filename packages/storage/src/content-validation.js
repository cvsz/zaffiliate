const ALLOWED_MEDIA_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm'
]);

function startsWithBytes(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(buffer, start, end) {
  if (buffer.length < end) return '';
  return buffer.subarray(start, end).toString('ascii');
}

export function sniffMediaMime(body) {
  if (!Buffer.isBuffer(body)) throw new TypeError('body must be a Buffer');

  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(body, 0, 4) === 'RIFF' && ascii(body, 8, 12) === 'WEBP') return 'image/webp';
  if (startsWithBytes(body, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';

  // ISO Base Media File Format. QuickTime uses the `qt  ` major brand;
  // MP4 commonly uses isom/iso*/mp4*/avc1/M4* brands. Unknown ftyp brands are
  // not accepted as MP4 so arbitrary boxes cannot bypass content validation.
  if (body.length >= 12 && ascii(body, 4, 8) === 'ftyp') {
    const brand = ascii(body, 8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |M4A )$/.test(brand)) return 'video/mp4';
  }

  return 'application/octet-stream';
}

export function assertMediaContentMatches(body, declaredMime) {
  if (!Buffer.isBuffer(body)) throw new TypeError('body must be a Buffer');
  const declared = String(declaredMime ?? '').trim().toLowerCase();
  if (!ALLOWED_MEDIA_MIME.has(declared)) {
    const error = new Error(`mime type not allowed: ${declared || '(none)'}`);
    error.code = 'MEDIA_MIME_NOT_ALLOWED';
    throw error;
  }
  const detected = sniffMediaMime(body);
  if (detected !== declared) {
    const error = new Error(`media content does not match declared mime: declared=${declared}, detected=${detected}`);
    error.code = 'MEDIA_MIME_MISMATCH';
    error.declaredMime = declared;
    error.detectedMime = detected;
    throw error;
  }
  return Object.freeze({ declaredMime: declared, detectedMime: detected });
}

export function isAllowedMediaMime(value) {
  return ALLOWED_MEDIA_MIME.has(String(value ?? '').trim().toLowerCase());
}
