import { useLoaderData } from 'react-router-dom';
import { getAudit } from '../api';

export async function loader() {
  const outcome = await getAudit();
  return outcome.ok ? outcome.body.rows || [] : [];
}

export default function Audit() {
  const rows = useLoaderData();

  return (
    <div className="panel">
      <h3>Audit trail</h3>
      <div className="data">
        <table>
          <thead>
            <tr>
              <th>At</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.at}</td>
                <td>{row.actor}</td>
                <td>{row.action}</td>
                <td>{row.resource}</td>
                <td>
                  <span className={`badge ${row.outcome}`}>{row.outcome}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
