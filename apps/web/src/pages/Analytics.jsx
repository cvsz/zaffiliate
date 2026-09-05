import { useLoaderData } from 'react-router-dom';
import { getAnalyticsFunnel } from '../api';

export async function loader() {
  const outcome = await getAnalyticsFunnel();
  return outcome.ok ? outcome.body : null;
}

export default function Analytics() {
  const funnel = useLoaderData();

  if (!funnel) {
    return <p className="error">Failed to load funnel.</p>;
  }

  return (
    <div className="panel">
      <h3>Attribution funnel</h3>
      <p className="note">
        {funnel.window} · attribution model: {funnel.attributionModel}
      </p>
      <div className="data">
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Events</th>
              <th>Step conversion</th>
            </tr>
          </thead>
          <tbody>
            {funnel.stages.map((stage) => (
              <tr key={stage.stage}>
                <td>{stage.stage}</td>
                <td>{stage.events.toLocaleString()}</td>
                <td>{`${stage.conversionPct.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h4>Attributed totals</h4>
        <div className="data">
          <table>
            <tbody>
              <tr>
                <td>Orders</td>
                <td>{funnel.totals.orders.toLocaleString()}</td>
              </tr>
              <tr>
                <td>GMV</td>
                <td>
                  {`$${(funnel.totals.gmvMinor / 100).toLocaleString()} ${funnel.currency ?? 'USD'}`}
                </td>
              </tr>
              <tr>
                <td>Commission</td>
                <td>
                  {`$${(funnel.totals.commissionMinor / 100).toLocaleString()} ${funnel.currency ?? 'USD'}`}
                </td>
              </tr>
              <tr>
                <td>Margin</td>
                <td>{`${funnel.totals.marginPct.toFixed(2)}%`}</td>
              </tr>
              <tr>
                <td>Settlement reference</td>
                <td>{funnel.totals.settlementRef}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
