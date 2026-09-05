import { useLoaderData } from 'react-router-dom';

const publications = [
  { id: 'PUB-1021', title: 'Summer essentials roundup', channel: 'tiktok', status: 'published', publishedAt: '2026-08-20T10:00:00Z' },
  { id: 'PUB-1022', title: 'Shopee picks of the week', channel: 'shopee', status: 'scheduled', publishedAt: '2026-09-05T08:00:00Z' },
  { id: 'PUB-1023', title: 'Lazada flash sale brief', channel: 'lazada', status: 'draft', publishedAt: null }
];

export async function loader() {
  return { publications };
}

export default function Publications() {
  const { publications } = useLoaderData();

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>Publications</h3>
        <button className="btn" type="button">New publication</button>
      </div>
      <div className="data">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Published at</th>
            </tr>
          </thead>
          <tbody>
            {publications.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.title}</td>
                <td>{p.channel}</td>
                <td>
                  <span className={`badge ${p.status}`}>{p.status}</span>
                </td>
                <td>{p.publishedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Calendar, approvals and multi-channel delivery are managed in the API layer.</p>
    </div>
  );
}
