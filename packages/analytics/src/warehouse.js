export function createWarehouse({ maxRows = 10000 } = {}) {
  const byTenant = new Map();
  function bucket(tenantId) {
    const tid = String(tenantId ?? '').trim().toLowerCase();
    if (!tid) throw new Error('tenantId is required');
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    return byTenant.get(tid);
  }
  function ingest(tenantId, row) {
    if (!row || typeof row !== 'object') throw new Error('row must be an object');
    const b = bucket(tenantId);
    if (b.length >= maxRows) b.shift();
    const entry = Object.freeze({ tenantId: String(tenantId).toLowerCase(), ...row, ingestedAt: new Date().toISOString() });
    b.push(entry);
    return entry;
  }
  function query(tenantId, { limit = 100 } = {}) {
    const b = bucket(tenantId);
    return Object.freeze([...b].slice(-Math.min(Math.max(Number(limit) || 100, 1), 500)));
  }
  function exportCsv(tenantId) {
    const rows = bucket(tenantId);
    if (!rows.length) return 'tenantId,eventId,type,occurredAt\n';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const r of rows) lines.push(headers.map((h) => JSON.stringify(r[h] ?? '')).join(','));
    return lines.join('\n') + '\n';
  }
  return Object.freeze({ ingest, query, exportCsv });
}
