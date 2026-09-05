import { useLoaderData } from 'react-router-dom';
import { getBillingSummary } from '../api';

export async function loader() {
  const outcome = await getBillingSummary();
  return outcome.ok ? outcome.body : null;
}

export default function Billing() {
  const billing = useLoaderData();

  if (!billing) {
    return <p className="error">Failed to load billing.</p>;
  }

  return (
    <div className="panel">
      <h3>Plan and usage</h3>
      <div className="panel">
        <h4>Subscription</h4>
        <div className="data">
          <table>
            <tbody>
              <tr>
                <td>Tenant</td>
                <td>{billing.tenant}</td>
              </tr>
              <tr>
                <td>Plan</td>
                <td>{billing.plan}</td>
              </tr>
              <tr>
                <td>Period</td>
                <td>{billing.period}</td>
              </tr>
              <tr>
                <td>MRR</td>
                <td>{`$${(billing.mrrMinor / 100).toLocaleString()} ${billing.currency ?? 'USD'}`}</td>
              </tr>
              <tr>
                <td>Ledger reference</td>
                <td>{billing.ledgerRef}</td>
              </tr>
              <tr>
                <td>Invoice reference</td>
                <td>{billing.invoiceRef}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h4>Usage</h4>
        <div className="data">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Used</th>
                <th>Quota</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(billing.quotas).map((metric) => {
                const used = billing.usage[metric] ?? 0;
                const quota = billing.quotas[metric] ?? 0;
                const utilization = quota === 0 ? 0 : ((used / quota) * 100).toFixed(2);
                return (
                  <tr key={metric}>
                    <td>{metric}</td>
                    <td>{used.toLocaleString()}</td>
                    <td>{quota.toLocaleString()}</td>
                    <td>{`${utilization}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
