import { useLoaderData } from 'react-router-dom';
import { getOutreachAttempts } from '../api';

export async function loader() {
  const outcome = await getOutreachAttempts();
  return outcome.ok ? outcome.body.attempts || [] : [];
}

export default function Outreach() {
  const attempts = useLoaderData();

  return (
    <div className="panel">
      <h3>Outreach attempts</h3>
      <div className="data">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Channel</th>
              <th>Creator</th>
              <th>Template</th>
              <th>Consent reference</th>
              <th>Status</th>
              <th>Sent at</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => (
              <tr key={attempt.id}>
                <td>{attempt.id}</td>
                <td>{attempt.channel}</td>
                <td>{attempt.creator}</td>
                <td>{attempt.template}</td>
                <td>{attempt.consentRef}</td>
                <td>
                  <span className={`badge ${attempt.status}`}>{attempt.status}</span>
                </td>
                <td>{attempt.sentAt ?? 'not sent'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Suppression is enforced from consent references before any send.</p>
    </div>
  );
}
