import { useActionState } from 'react';
import { useLoaderData, useNavigation } from 'react-router-dom';
import { getPendingApprovals } from '../api';

export async function loader() {
  const outcome = await getPendingApprovals();
  return outcome.ok ? outcome.body.approvals || [] : [];
}

export async function action({ request }) {
  const formData = await request.formData();
  const approvalId = String(formData.get('approvalId') || '');
  const decision = String(formData.get('decision') || '');
  const result = await fetch('/api/workflow/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-zaff-csrf': '1', 'x-tenant-id': document.getElementById('tenant')?.value || 'tenant-acme' },
    body: JSON.stringify({ approvalId, decision })
  });
  const body = await result.json();
  if (!result.ok) {
    return { error: body.error || 'Decision failed', status: result.status };
  }
  return body;
}

export default function Workflows() {
  const approvals = useLoaderData();
  const [state, formAction, isPending] = useActionState(action, null);
  const navigation = useNavigation();

  return (
    <div className="panel">
      <h3>Pending approvals</h3>
      {navigation.state === 'loading' && <p className="note">Loading approvals…</p>}
      {approvals.length === 0 ? (
        <p className="empty">Queue is clear. No pending approvals.</p>
      ) : (
        <div className="data">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kind</th>
                <th>Title</th>
                <th>Requested by</th>
                <th>Impact</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.id}>
                  <td>{approval.id}</td>
                  <td>{approval.kind}</td>
                  <td>{approval.title}</td>
                  <td>{approval.requestedBy}</td>
                  <td>{`$${(approval.impactMinor / 100).toLocaleString()}`}</td>
                  <td>
                    <span className={`badge ${approval.status}`}>{approval.status}</span>
                  </td>
                  <td>
                    <form method="post" action={formAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="approvalId" value={approval.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className="btn approve" type="submit" disabled={isPending}>
                        {isPending ? 'Working…' : 'Approve'}
                      </button>
                    </form>{' '}
                    <form method="post" action={formAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="approvalId" value={approval.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <button className="btn reject" type="submit" disabled={isPending}>
                        {isPending ? 'Working…' : 'Reject'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state?.error && <p className="error">Decision refused ({state.status}): {state.error}</p>}
    </div>
  );
}
