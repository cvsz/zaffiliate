import { createDbClient } from '../../packages/db/src/index.js';

function minor(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function createProductionDataProviders({ databaseUrl = process.env.DATABASE_URL, db = null, env = process.env } = {}) {
  const database = db ?? createDbClient({ connectionString: databaseUrl });

  async function tenantTx(tenantId, fn) {
    return database.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return fn(tx);
    });
  }

  async function analyticsSummary(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const conversions = await tx.query(
        `SELECT currency,
                COALESCE(sum(commission) FILTER (WHERE status='confirmed'),0) AS confirmed_commission,
                COALESCE(sum(commission) FILTER (WHERE status='pending'),0) AS pending_commission,
                count(*) FILTER (WHERE status='confirmed')::int AS conversions
           FROM conversions
          WHERE tenant_id=$1
          GROUP BY currency`,
        [tenantId]
      );
      if (conversions.rows.length > 1) throw new Error('mixed_currency_summary_requires_filter');
      const row = conversions.rows[0] ?? { currency: 'THB', confirmed_commission: 0, pending_commission: 0, conversions: 0 };
      const clicks = await tx.query(
        `SELECT count(*)::int AS count FROM analytics_events
          WHERE tenant_id=$1 AND event_type='click' AND occurred_at >= now() - interval '30 days'`,
        [tenantId]
      );
      const published = await tx.query(
        `SELECT count(*)::int AS count FROM publication_jobs WHERE tenant_id=$1 AND status='published'`,
        [tenantId]
      );
      return {
        currency: row.currency,
        netCommissionMinorUnits: minor(row.confirmed_commission),
        pendingCommissionMinorUnits: minor(row.pending_commission),
        conversions: Number(row.conversions || 0),
        clicks: Number(clicks.rows[0]?.count || 0),
        publishedContent: Number(published.rows[0]?.count || 0),
        ctr: null,
        cvr: null,
        epcMinorUnits: null
      };
    });
  }

  async function publishedContentCount(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const r = await tx.query("SELECT count(*)::int AS count FROM publication_jobs WHERE tenant_id=$1 AND status='published'", [tenantId]);
      return Number(r.rows[0]?.count || 0);
    });
  }

  async function revenueTrend(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT date_trunc('day', occurred_at)::date::text AS date,
                currency,
                COALESCE(sum(commission),0) AS commission,
                count(*)::int AS conversions
           FROM conversions
          WHERE tenant_id=$1 AND status='confirmed' AND occurred_at >= current_date - interval '6 days'
          GROUP BY 1,2 ORDER BY 1`,
        [tenantId]
      );
      const currencies = new Set(r.rows.map((x) => x.currency));
      if (currencies.size > 1) throw new Error('mixed_currency_trend_requires_filter');
      return r.rows.map((row) => ({
        date: row.date,
        netCommissionMinorUnits: minor(row.commission),
        conversions: Number(row.conversions || 0),
        currency: row.currency
      }));
    });
  }

  async function providerHealth(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT status, scope, last_successful_api_call_at, last_error
           FROM tiktok_accounts WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 20`,
        [tenantId]
      );
      const tiktok = r.rows.length ? {
        platform: 'tiktok',
        status: r.rows.some((x) => x.status === 'connected') ? 'healthy' : 'degraded',
        lastVerifiedAt: r.rows.map((x) => x.last_successful_api_call_at).filter(Boolean).sort().at(-1) ?? null,
        reason: r.rows.find((x) => x.last_error)?.last_error ?? null,
        scopes: [...new Set(r.rows.flatMap((x) => String(x.scope ?? '').split(/[ ,]+/).filter(Boolean)))]
      } : { platform: 'tiktok', status: 'not_configured', lastVerifiedAt: null, scopes: [] };

      const configured = (name) => Boolean(String(env[name] ?? '').trim());
      return [
        tiktok,
        { platform: 'shopee', status: configured('SHOPEE_CREDENTIALS_REF') ? 'configured_unverified' : 'not_configured', lastVerifiedAt: null },
        { platform: 'facebook', status: configured('META_CREDENTIALS_REF') ? 'configured_unverified' : 'not_configured', lastVerifiedAt: null },
        { platform: 'youtube', status: configured('YOUTUBE_CREDENTIALS_REF') ? 'configured_unverified' : 'not_configured', lastVerifiedAt: null }
      ];
    });
  }

  async function workerHealth(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const [pub, outbox, jobs] = await Promise.all([
        tx.query(`SELECT count(*)::int AS depth FROM publication_jobs WHERE tenant_id=$1 AND status IN ('scheduled','failed','partial')`, [tenantId]),
        tx.query(`SELECT count(*)::int AS depth FROM outreach_outbox WHERE tenant_id=$1 AND status IN ('pending','failed')`, [tenantId]),
        tx.query(`SELECT count(*)::int AS depth FROM jobs WHERE tenant_id=$1 AND state IN ('queued','failed','waiting_approval')`, [tenantId])
      ]);
      return [
        { name: 'publication-claimer', status: 'observed', depth: Number(pub.rows[0]?.depth || 0) },
        { name: 'outreach-outbox', status: 'observed', depth: Number(outbox.rows[0]?.depth || 0) },
        { name: 'workflow', status: 'observed', depth: Number(jobs.rows[0]?.depth || 0) }
      ];
    });
  }

  async function audit(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT id::text, occurred_at AS at, actor_id AS actor, action,
                resource_type || '/' || resource_id AS resource, outcome, reason
           FROM audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 100`,
        [tenantId]
      );
      return r.rows;
    });
  }

  async function billing(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const posted = await tx.query(
        `SELECT currency, count(*)::int AS transactions
           FROM ledger_transactions WHERE tenant_id=$1 AND status='posted'
           GROUP BY currency ORDER BY currency`,
        [tenantId]
      );
      const ai = await tx.query(
        `SELECT COALESCE(sum(input_tokens),0)::bigint::text AS input_tokens,
                COALESCE(sum(output_tokens),0)::bigint::text AS output_tokens,
                COALESCE(sum(actual_cost),0)::text AS actual_cost
           FROM ai_usage WHERE tenant_id=$1 AND created_at >= date_trunc('month', now())`,
        [tenantId]
      );
      return {
        source: 'ledger',
        period: new Date().toISOString().slice(0, 7),
        plan: null,
        mrrMinor: null,
        currency: posted.rows.length === 1 ? posted.rows[0].currency : null,
        ledgerRef: 'postgres:ledger_transactions',
        invoiceRef: null,
        usage: {
          ai_input_tokens: Number(ai.rows[0]?.input_tokens || 0),
          ai_output_tokens: Number(ai.rows[0]?.output_tokens || 0)
        },
        quotas: {},
        ledger: { currencies: posted.rows },
        aiUsage: {
          inputTokens: Number(ai.rows[0]?.input_tokens || 0),
          outputTokens: Number(ai.rows[0]?.output_tokens || 0),
          actualCost: Number(ai.rows[0]?.actual_cost || 0)
        }
      };
    });
  }

  async function pendingApprovals(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT j.id::text AS id, j.action AS kind, j.resource_id AS title,
                j.actor_id AS "requestedBy", 0::int AS "impactMinor", 'pending' AS status,
                j.created_at AS "createdAt"
           FROM jobs j
          WHERE j.tenant_id=$1 AND j.state='waiting_approval'
            AND NOT EXISTS (
              SELECT 1 FROM approvals a
               WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id
                 AND a.decision='approved' AND a.expires_at > now()
            )
          ORDER BY j.created_at ASC LIMIT 100`,
        [tenantId]
      );
      return r.rows;
    });
  }

  async function decideApproval({ tenantId, jobId, userId, decision }) {
    return tenantTx(tenantId, async (tx) => {
      const locked = await tx.query("SELECT * FROM jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, jobId]);
      const job = locked.rows[0];
      if (!job) return { status: 404, error: 'approval_not_found' };
      if (job.state !== 'waiting_approval') return { status: 409, error: 'already_decided' };
      const dbDecision = decision === 'approve' ? 'approved' : 'rejected';
      const nextState = decision === 'approve' ? 'queued' : 'cancelled';
      const inserted = await tx.query(
        `INSERT INTO approvals
          (tenant_id, job_id, approver_id, actor_id, action, resource_id, idempotency_key, decision, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '15 minutes')
         RETURNING id::text, decision, decided_at AS "decidedAt", expires_at AS "expiresAt"`,
        [tenantId, job.id, userId, job.actor_id, job.action, job.resource_id, job.idempotency_key, dbDecision]
      );
      await tx.query("UPDATE jobs SET state=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='waiting_approval'", [tenantId, job.id, nextState]);
      await tx.query(
        `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
         VALUES ($1,$2,'workflow.approval_decided','job',$3,'allowed',$4,$5::jsonb)`,
        [tenantId, userId, String(job.id), dbDecision, JSON.stringify({ approvalId: inserted.rows[0].id, decision: dbDecision })]
      );
      return { status: 200, approval: { id: inserted.rows[0].id, jobId: String(job.id), status: dbDecision, ...inserted.rows[0] } };
    });
  }

  async function funnel(tenantId) {
    return tenantTx(tenantId, async (tx) => {
      const events = await tx.query(
        `SELECT event_type AS stage, count(*)::int AS events
           FROM analytics_events WHERE tenant_id=$1 AND occurred_at >= now()-interval '30 days'
          GROUP BY event_type ORDER BY min(occurred_at)`,
        [tenantId]
      );
      const stages = [];
      let previous = null;
      for (const row of events.rows) {
        const count = Number(row.events || 0);
        stages.push({
          stage: row.stage,
          events: count,
          conversionPct: previous == null || previous === 0 ? (previous == null ? 100 : 0) : (count / previous) * 100
        });
        previous = count;
      }
      const totalsResult = await tx.query(
        `SELECT currency, count(*)::int AS orders,
                COALESCE(sum(gross_revenue),0) AS gmv,
                COALESCE(sum(commission),0) AS commission,
                COALESCE(sum(true_margin),0) AS true_margin
           FROM conversions
          WHERE tenant_id=$1 AND status='confirmed' AND occurred_at >= now()-interval '30 days'
          GROUP BY currency`,
        [tenantId]
      );
      if (totalsResult.rows.length > 1) throw new Error('mixed_currency_funnel_requires_filter');
      const total = totalsResult.rows[0] ?? { currency: 'THB', orders: 0, gmv: 0, commission: 0, true_margin: 0 };
      const gmvMinor = minor(total.gmv);
      const trueMarginMinor = minor(total.true_margin);
      return {
        window: '30d',
        attributionModel: 'provider-reconciled confirmed conversions',
        currency: total.currency,
        stages,
        totals: {
          orders: Number(total.orders || 0),
          gmvMinor,
          commissionMinor: minor(total.commission),
          trueMarginMinor,
          marginPct: gmvMinor === 0 ? 0 : (trueMarginMinor / gmvMinor) * 100,
          settlementRef: null,
          payoutsQueued: null
        }
      };
    });
  }

  async function close() { await database.close(); }

  return Object.freeze({
    analyticsSummary, publishedContentCount, revenueTrend, providerHealth, workerHealth,
    audit, billing, pendingApprovals, decideApproval, funnel, close
  });
}
