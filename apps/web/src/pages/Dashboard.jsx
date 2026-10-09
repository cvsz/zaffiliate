import { useLoaderData } from 'react-router-dom';
import { getOverview, getRevenueTrend, getIntegrationHealth, getWorkerHealth } from '../api';

export async function loader() {
  const [overview, trend, integrations, workers] = await Promise.all([
    getOverview(),
    getRevenueTrend(),
    getIntegrationHealth(),
    getWorkerHealth()
  ]);
  return {
    overview: overview.ok ? overview.body : null,
    trend: trend.ok ? trend.body : { points: [] },
    integrations: integrations.ok ? integrations.body : { integrations: [] },
    workers: workers.ok ? workers.body : { workers: [] },
    authRequired: [overview, trend, integrations, workers].some((r) => r.status === 401)
  };
}

function StatCard({ label, value, sub }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {sub && <span className="kpi__sub">{sub}</span>}
    </div>
  );
}

export default function Dashboard() {
  const { overview, trend, integrations, workers, authRequired } = useLoaderData();

  if (authRequired) {
    return <p className="error">Session required. <a href="/login">Sign in</a> to access the control plane.</p>;
  }

  if (!overview) {
    return <p className="error">Dashboard data unavailable.</p>;
  }

  return (
    <div>
      <div className="kpi-strip">
        {overview.kpis.primary.map((kpi) => (
          <StatCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.valueMinorUnits != null ? `${kpi.valueMinorUnits.toLocaleString()} ${kpi.currency ?? ''}`.trim() : String(kpi.value ?? 0)}
          />
        ))}
      </div>

      <div className="panel">
        <h3>Revenue trend</h3>
        <div className="data">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Net Commission</th>
                <th>Conversions</th>
              </tr>
            </thead>
            <tbody>
              {trend.points?.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{(point.netCommissionMinorUnits ?? 0).toLocaleString()}</td>
                  <td>{point.conversions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h3>Integration health</h3>
          <div className="data">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Last verified</th>
                </tr>
              </thead>
              <tbody>
                {integrations.integrations?.map((item) => (
                  <tr key={item.platform}>
                    <td>{item.platform}</td>
                    <td>
                      <span className={`badge ${item.status}`}>{item.status}</span>
                    </td>
                    <td>{item.lastVerifiedAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Worker health</h3>
          <div className="data">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Status</th>
                  <th>Queue depth</th>
                </tr>
              </thead>
              <tbody>
                {workers.workers?.map((item) => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td>
                      <span className={`badge ${item.status}`}>{item.status}</span>
                    </td>
                    <td>{item.depth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {overview.actionCenter?.length > 0 && (
        <div className="panel">
          <h3>Critical Action Center</h3>
          <div className="action-center">
            {overview.actionCenter.map((item) => (
              <div key={item.id} className="action-item">
                <span className={`badge badge--severity ${item.severity.toLowerCase()}`}>{item.severity}</span>
                <div>
                  <strong>{item.resource}</strong>
                  <p>{item.reason} — {item.impact}</p>
                  <p className="note">Next: {item.recommendedAction} · detected {item.detectedAt}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
