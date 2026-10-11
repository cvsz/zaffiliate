// A DR rehearsal mutates its target. Only the dedicated, locally published
// restore container endpoint is allowed; never accept a general localhost URL.
const RESTORE_URL = /^postgres(?:ql)?:\/\/zaffiliate:([^@/?#]+)@127\.0\.0\.1:55432\/zaffiliate_restore$/;

export function assertIsolatedRestoreTarget(value) {
  if (typeof value !== 'string' || !RESTORE_URL.test(value)) {
    throw new Error('DR target must be the dedicated loopback restore endpoint');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DR target URL is invalid');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || url.username !== 'zaffiliate'
      || !url.password
      || url.hostname !== '127.0.0.1'
      || url.port !== '55432'
      || url.pathname !== '/zaffiliate_restore'
      || url.search || url.hash) {
    throw new Error('DR target must be the dedicated loopback restore endpoint');
  }

  // Never return or log the password. This is an address-shape guard, not
  // proof that a particular Docker container owns the listening socket.
  return Object.freeze({ host: '127.0.0.1', port: 55432, database: 'zaffiliate_restore' });
}
