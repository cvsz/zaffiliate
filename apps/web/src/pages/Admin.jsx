import { useLoaderData } from 'react-router-dom';
import { getNavigation } from '../api';

export async function loader() {
  const outcome = await getNavigation();
  return outcome.ok ? outcome.body : null;
}

export default function Admin() {
  const manifest = useLoaderData();

  if (!manifest) {
    return <p className="error">Failed to load manifest.</p>;
  }

  return (
    <div className="panel">
      <h3>Operator console</h3>
      <div className="panel">
        <h4>Runtime</h4>
        <div className="data">
          <table>
            <tbody>
              <tr>
                <td>Product</td>
                <td>{manifest.product}</td>
              </tr>
              <tr>
                <td>Manifest version</td>
                <td>{manifest.version}</td>
              </tr>
              <tr>
                <td>Secret boundary</td>
                <td>{manifest.secretBoundary}</td>
              </tr>
              <tr>
                <td>Active tenant</td>
                <td>{manifest.tenant}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h4>Sections</h4>
        <div className="data">
          <table>
            <thead>
              <tr>
                <th>Surface</th>
                <th>Section id</th>
                <th>Route</th>
              </tr>
            </thead>
            <tbody>
              {manifest.sections.map((section) => (
                <tr key={section.id}>
                  <td>{section.label}</td>
                  <td>{section.id}</td>
                  <td>{section.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">Operator mutations require the x-tenant-id header and are recorded in the audit log.</p>
    </div>
  );
}
