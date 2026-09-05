import { useLoaderData } from 'react-router-dom';
import { getAnalyticsFunnel } from '../api';

export async function loader() {
  const outcome = await getAnalyticsFunnel();
  return outcome.ok ? outcome.body : null;
}

export default function Commissions() {
  const funnel = useLoaderData();

  if (!funnel) {
    return <p className="error">Failed to load commissions.</p>;
  }

  const totals = funnel.totals;
  const netMinor = totals.gmvMinor - totals.commissionMinor;
  const effectiveMargin = totals.gmvMinor === 0 ? 0 : (netMinor / totals.gmvMinor) * 100;

  return (
    <div className="panel">
      <h3>Margin and payouts</h3>
      <div className="panel">
        <h4>Period economics</h4>
        <div className="data">
          <table>
            <tbody>
              <tr>
                <td>Window</td>
                <td>{funnel.window}</td>
              </tr>
              <tr>
                <td>Attribution model</td>
                <td>{funnel.attributionModel}</td>
              </tr>
              <tr>
                <td>Orders</td>
                <td>{totals.orders.toLocaleString()}</td>
              </tr>
              <tr>
                <td>GMV</td>
                <td>
                  {`$${(totals.gmvMinor / 100).toLocaleString()} ${totals.currency ?? 'USD'}`}
                </td>
              </tr>
              <tr>
                <td>Commission owed</td>
                <td>
                  {`$${(totals.commissionMinor / 100).toLocaleString()} ${totals.currency ?? 'USD'}`}
                </td>
              </tr>
              <tr>
                <td>Net margin</td>
                <td>{`$${(netMinor / 100).toLocaleString()} ${totals.currency ?? 'USD'}`}</td>
              </tr>
              <tr>
                <td>Effective margin</td>
                <td>{`${effectiveMargin.toFixed(2)}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h4>Payout operations</h4>
        <div className="data">
          <table>
            <tbody>
              <tr>
                <td>Settlement account</td>
                <td>{totals.settlementRef}</td>
              </tr>
              <tr>
                <td>Payout batches queued</td>
                <td>{totals.payoutsQueued}</td>
              </tr>
              <tr>
                <td>Policy</td>
                <td>Funds release only after Approval Center sign-off</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
