export default function Unavailable() {
  return (
    <section className="panel" role="status" aria-live="polite">
      <h2>Production feature unavailable</h2>
      <p>This surface is disabled until authenticated, tenant-scoped data and an audited operator workflow are connected.</p>
      <p>No simulated campaign, financial, publication, or approval records are displayed in production.</p>
    </section>
  );
}
