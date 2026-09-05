import { useLoaderData } from 'react-router-dom';

const campaigns = [
  { id: 'CMP-88', name: 'Summer Sale Boost', platform: 'tiktok', status: 'active', budgetDaily: 20000, spentDaily: 18400, start: '2026-08-01', end: '2026-08-31' },
  { id: 'CMP-89', name: 'Back to School', platform: 'shopee', status: 'paused', budgetDaily: 15000, spentDaily: 9800, start: '2026-09-01', end: '2026-09-15' },
  { id: 'CMP-90', name: 'Loyalty Reactivation', platform: 'lazada', status: 'draft', budgetDaily: 12000, spentDaily: 0, start: '2026-09-10', end: '2026-09-30' }
];

export async function loader() {
  return { campaigns };
}

function statusBadge(status) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export default function Campaigns() {
  const { campaigns } = useLoaderData();

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>Campaigns</h3>
        <button className="btn" type="button">New campaign</button>
      </div>
      <div className="data">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Daily budget</th>
              <th>Spent today</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.name}</td>
                <td>{c.platform}</td>
                <td>{statusBadge(c.status)}</td>
                <td>${(c.budgetDaily / 100).toLocaleString()}</td>
                <td>${(c.spentDaily / 100).toLocaleString()}</td>
                <td>{c.start}</td>
                <td>{c.end}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Lifecycle state, pacing and platform routing are available in the API layer.</p>
    </div>
  );
}
