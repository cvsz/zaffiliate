import { useLoaderData } from 'react-router-dom';

export async function loader() {
  const [overviewRes, trendRes, integrationsRes, workersRes] = await Promise.all([
    fetch('/api/ui/overview', { headers: { 'x-tenant-id': document.getElementById('tenant')?.value || 'tenant-acme' } }),
    fetch('/api/ui/revenue-trend', { headers: { 'x-tenant-id': document.getElementById('tenant')?.value || 'tenant-acme' } }),
    fetch('/api/ui/integration-health', { headers: { 'x-tenant-id': document.getElementById('tenant')?.value || 'tenant-acme' } }),
    fetch('/api/ui/worker-health', { headers: { 'x-tenant-id': document.getElementById('tenant')?.value || 'tenant-acme' } })
  ]);

  const overview = overviewRes.ok ? await overviewRes.json() : null;
  const trend = trendRes.ok ? await trendRes.json() : { points: [] };
  const integrations = integrationsRes.ok ? await integrationsRes.json() : { integrations: [] };
  const workers = workersRes.ok ? await workersRes.json() : { workers: [] };

  return { overview, trend, integrations, workers };
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
  const { overview, trend, integrations, workers } = useLoaderData();

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
