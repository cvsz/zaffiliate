import { useLoaderData } from 'react-router-dom';

const conversions = [
  { id: 'CNV-4401', date: '2026-08-21', channel: 'tiktok', campaign: 'CMP-88', revenueMinor: 259900, commissionMinor: 38985, status: 'settled' },
  { id: 'CNV-4402', date: '2026-08-21', channel: 'shopee', campaign: 'CMP-89', revenueMinor: 189500, commissionMinor: 28425, status: 'pending' },
  { id: 'CNV-4403', date: '2026-08-20', channel: 'lazada', campaign: 'CMP-90', revenueMinor: 142000, commissionMinor: 21300, status: 'pending' }
];

const summary = {
  window: '2026-08-14 / 2026-08-21',
  orders: conversions.length,
  gmvMinor: conversions.reduce((sum, c) => sum + c.revenueMinor, 0),
  commissionMinor: conversions.reduce((sum, c) => sum + c.commissionMinor, 0),
  currency: 'USD'
};

export async function loader() {
  return { conversions, summary };
}

export default function Conversions() {
  const { conversions, summary } = useLoaderData();
  const marginPct = summary.gmvMinor === 0 ? 0 : ((summary.gmvMinor - summary.commissionMinor) / summary.gmvMinor) * 100;

  return (
    <div className="panel">
      <h3>Conversions</h3>
      <div className="grid">
        <div className="panel">
          <h4>Period summary</h4>
          <div className="data">
            <table>
              <tbody>
                <tr>
                  <td>Window</td>
                  <td>{summary.window}</td>
                </tr>
                <tr>
                  <td>Orders</td>
                  <td>{summary.orders}</td>
                </tr>
                <tr>
                  <td>GMV</td>
                  <td>{`$${(summary.gmvMinor / 100).toLocaleString()} ${summary.currency}`}</td>
                </tr>
                <tr>
                  <td>Commission</td>
                  <td>{`$${(summary.commissionMinor / 100).toLocaleString()} ${summary.currency}`}</td>
                </tr>
                <tr>
                  <td>Effective margin</td>
                  <td>{`${marginPct.toFixed(2)}%`}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h4>Recent conversions</h4>
          <div className="data">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Channel</th>
                  <th>Campaign</th>
                  <th>Revenue</th>
                  <th>Commission</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.date}</td>
                    <td>{c.channel}</td>
                    <td>{c.campaign}</td>
                    <td>{`$${(c.revenueMinor / 100).toLocaleString()}`}</td>
                    <td>{`$${(c.commissionMinor / 100).toLocaleString()}`}</td>
                    <td>
                      <span className={`badge ${c.status}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
