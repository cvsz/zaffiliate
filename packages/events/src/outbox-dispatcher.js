export function createAffiliateOutboxDispatcher({ repo, publisher, stream = 'affiliate-events', workerId = `affiliate-outbox-${process.pid}`, batchSize = 50, leaseMs = 30000, retryDelayMs = 1000, logger = null } = {}) {
  if (!repo || typeof repo.claimOutbox !== 'function' || typeof repo.markOutboxDispatched !== 'function' || typeof repo.releaseOutbox !== 'function') throw new TypeError('outbox repository is required');
  if (!publisher || typeof publisher.publish !== 'function') throw new TypeError('stream publisher is required');
  if (!String(stream).trim()) throw new Error('stream is required');
  if (!String(workerId).trim()) throw new Error('workerId is required');

  async function dispatchOnce(tenantId) {
    const claimed = await repo.claimOutbox(tenantId, { limit: batchSize, workerId, leaseMs });
    let published = 0;
    let failed = 0;
    for (const event of claimed) {
      try {
        await publisher.publish({ stream, tenantId: event.tenantId, type: event.type, payload: event.payload, eventId: event.eventId });
        const marked = await repo.markOutboxDispatched(event.tenantId, event.eventId);
        if (!marked) throw new Error(`outbox event ${event.eventId} was not marked dispatched`);
        published += 1;
        logger?.info?.('affiliate_outbox_dispatched', { eventId: event.eventId, tenantId: event.tenantId, type: event.type, attempts: event.attempts });
      } catch (error) {
        failed += 1;
        try {
          await repo.releaseOutbox(event.tenantId, event.eventId, error, { retryDelayMs });
        } catch (releaseError) {
          logger?.error?.('affiliate_outbox_release_failed', { eventId: event.eventId, tenantId: event.tenantId, error: releaseError instanceof Error ? releaseError.message : String(releaseError) });
        }
        logger?.warn?.('affiliate_outbox_dispatch_failed', { eventId: event.eventId, tenantId: event.tenantId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return Object.freeze({ claimed: claimed.length, published, failed });
  }

  return Object.freeze({ dispatchOnce, stream, workerId });
}
