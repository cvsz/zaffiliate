import { useLoaderData } from 'react-router-dom';

const settings = {
  tenant: 'tenant-acme',
  plan: 'scale',
  notifications: { email: true, slack: false, webhook: true },
  defaultCurrency: 'USD',
  attributionModel: 'last-touch-subid',
  autoPublish: false,
  retentionDays: 365
};

export async function loader() {
  return { settings };
}

export default function Settings() {
  const { settings } = useLoaderData();

  return (
    <div className="panel">
      <h3>Settings</h3>
      <div className="grid">
        <div className="panel">
          <h4>General</h4>
          <div className="data">
            <table>
              <tbody>
                <tr>
                  <td>Tenant</td>
                  <td>{settings.tenant}</td>
                </tr>
                <tr>
                  <td>Plan</td>
                  <td>{settings.plan}</td>
                </tr>
                <tr>
                  <td>Default currency</td>
                  <td>{settings.defaultCurrency}</td>
                </tr>
                <tr>
                  <td>Attribution model</td>
                  <td>{settings.attributionModel}</td>
                </tr>
                <tr>
                  <td>Retention</td>
                  <td>{settings.retentionDays} days</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h4>Automation</h4>
          <div className="data">
            <table>
              <tbody>
                <tr>
                  <td>Auto-publish</td>
                  <td>
                    <span className={`badge ${settings.autoPublish ? 'approved' : 'rejected'}`}>
                      {settings.autoPublish ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Email notifications</td>
                  <td>
                    <span className={`badge ${settings.notifications.email ? 'approved' : 'rejected'}`}>
                      {settings.notifications.email ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Slack notifications</td>
                  <td>
                    <span className={`badge ${settings.notifications.slack ? 'approved' : 'rejected'}`}>
                      {settings.notifications.slack ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Webhook delivery</td>
                  <td>
                    <span className={`badge ${settings.notifications.webhook ? 'approved' : 'rejected'}`}>
                      {settings.notifications.webhook ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="note">Operator mutations require the x-tenant-id header and are recorded in the audit log.</p>
    </div>
  );
}
