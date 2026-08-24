function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export async function saveAnalyticsEvents(client, tenantId, envelopes) {
  const id = requireText(tenantId, 'tenantId');
  const list = (envelopes ?? []).filter((envelope, index, all) =>
    all.findIndex((candidate) => candidate.eventId === envelope.eventId) === index
  );
  if (list.length === 0) return { inserted: 0 };
  const values = [];
  const params = [];
  let position = 1;
  list.forEach((envelope, index) => {
    const dimensions = {
      lineage: envelope.lineage ?? {},
      payload: envelope.payload ?? {},
      sourceType: envelope.sourceType,
      provider: envelope.provider,
      externalEventId: envelope.externalEventId ?? null,
      correlationId: envelope.correlationId ?? null
    };
    const measures = {};
    values.push(`($${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}::jsonb, $${position++}::jsonb)`);
    params.push(
      id,
      envelope.eventId,
      envelope.eventType,
      envelope.occurredAt,
      envelope.receivedAt,
      JSON.stringify(dimensions),
      JSON.stringify(measures)
    );
    void index;
  });
  const text = `INSERT INTO analytics_events (tenant_id, event_id, event_type, occurred_at, received_at, dimensions, measures) VALUES ${values.join(', ')}`;
  await client.query(text, params);
  return { inserted: list.length };
}

export async function listRecentAnalyticsEvents(client, tenantId, limit = 50) {
  const result = await client.query(
    'SELECT event_id, event_type, occurred_at, received_at, dimensions FROM analytics_events WHERE tenant_id = $1 ORDER BY received_at DESC LIMIT $2',
    [requireText(tenantId, 'tenantId'), Math.max(1, Math.min(Number(limit) || 50, 500))]
  );
  return (result.rows ?? []).map((row) => ({
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    lineage: row.dimensions?.lineage ?? {},
    payload: row.dimensions?.payload ?? {}
  }));
}
