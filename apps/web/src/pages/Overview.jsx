import { useLoaderData } from 'react-router-dom';
import { getOverview, getRevenueTrend, getIntegrationHealth, getWorkerHealth } from '../api';

export async function loader() {
  const [ov, tr, ih, wh] = await Promise.all([
    getOverview(),
    getRevenueTrend(),
    getIntegrationHealth(),
    getWorkerHealth()
  ]);
  return {
    overview: ov.ok ? ov.body : null,
    trend: tr.ok ? tr.body.points || [] : [],
    integrations: ih.ok ? ih.body.integrations || [] : [],
    workers: wh.ok ? wh.body.workers || [] : []
  };
}

export default function Overview() {
  const { overview, trend, integrations, workers } = useLoaderData();

  if (!overview) {
    return <p className="error">Mission Control could not load.</p>;
  }

  return (
    <div>
      <div className="kpi-strip">
        {overview.kpis.primary.map((kpi) => (
          <div key={kpi.id} className="kpi kpi--primary">
            <span className="kpi__label">{kpi.label}</span>
            <span className="kpi__value">
              {kpi.valueMinorUnits != null
                ? `${kpi.valueMinorUnits.toLocaleString()} ${kpi.currency ?? ''}`.trim()
                : String(kpi.value ?? 0)}
            </span>
          </div>
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
              {trend.map((point) => (
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
              {integrations.map((item) => (
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
              {workers.map((item) => (
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

      {overview.actionCenter.length > 0 && (
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
