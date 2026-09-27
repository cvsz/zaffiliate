import { useState } from 'react';

const features = [
  { id: 'desktop', area: 'Windows Desktop', priority: 'P1', state: 'PLANNED', gate: 'Clean Windows 11 install, update, uninstall, signed-build strategy', detail: 'Tauri 2 shell reusing existing React/Vite control plane; no client-side provider secrets.' },
  { id: 'products', area: 'Products & Affiliate Links', priority: 'P1', state: 'PARTIAL', gate: 'Tenant-scoped product import, affiliate link and commission snapshots', detail: 'Reuse canonical affiliate core and Shopee Thailand CSV ingestion; verify live provider entitlements.' },
  { id: 'content', area: 'AI Content Studio', priority: 'P1', state: 'PARTIAL', gate: 'Real 9:16 FFmpeg render, subtitles, asset licenses and deterministic tests', detail: 'Existing video factory returns a placeholder URL; never present it as a rendered MP4.' },
  { id: 'approval', area: 'Approval & Scheduler', priority: 'P0', state: 'VERIFY', gate: 'Immutable media+metadata+account approval; restart and duplicate-delivery tests', detail: 'Extend existing policy gate and durable outbox; quarantine ambiguous remote upload status.' },
  { id: 'tiktok', area: 'TikTok Posting', priority: 'P1', state: 'BLOCKED', gate: 'App audit, video.publish entitlement, creator consent and real-account evidence', detail: 'Keep public publishing disabled until documented permissions and E2E verification.' },
  { id: 'shopee', area: 'Shopee Video / Live', priority: 'P1', state: 'BLOCKED', gate: 'Separate regional partner entitlements for Video and Live', detail: 'Affiliate product API access does not imply permission to publish Video or start Live.' },
  { id: 'meta', area: 'Facebook Reels', priority: 'P1', state: 'BLOCKED', gate: 'Page permissions, upload and processing reconciliation', detail: 'Use official Meta Graph API; no browser posting workarounds.' },
  { id: 'youtube', area: 'YouTube Shorts', priority: 'P1', state: 'BLOCKED', gate: 'OAuth videos.insert, audit/quota and processing reconciliation', detail: 'Respect private-upload restrictions for unverified API projects.' },
  { id: 'analytics', area: 'Analytics & Commissions', priority: 'P2', state: 'PARTIAL', gate: 'Source freshness, refunds, verified versus estimated payout and tenant isolation', detail: 'Reuse existing analytics and conversion reconciliation; do not invent missing provider metrics.' },
  { id: 'security', area: 'Security & Operations', priority: 'P0', state: 'VERIFY', gate: 'CodeQL triage, secret scanning, isolated restore, rollback and release evidence', detail: 'Inspect open security alert #2 before release; never dismiss without root-cause evidence.' }
];

const statusLabels = { PLANNED: 'Not implemented', PARTIAL: 'Partial / requires verification', VERIFY: 'Verification required', BLOCKED: 'External permission required' };

export default function AutopilotReview() {
  const [filter, setFilter] = useState('ALL');
  const [notes, setNotes] = useState({});
  const visible = filter === 'ALL' ? features : features.filter((item) => item.state === filter);
  const exportReview = () => {
    const report = { generatedAt: new Date().toISOString(), source: 'operator review only; statuses are baseline assessments, not live health checks', items: features.map(({ id, ...item }) => ({ id, ...item, reviewerNote: notes[id] || '' })) };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'autopilot-review.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-label="Autopilot desktop review">
      <div className="panel">
        <h2>ZEAZ Affiliate Autopilot — Desktop Review</h2>
        <p className="note">Planning and acceptance review. This page does not claim live platform authorization, completed builds or production readiness. No publishing actions are performed here.</p>
        <p className="note">Source: <a href="https://github.com/cvsz/zaffiliate/blob/main/docs/architecture/WINDOWS-AFFILIATE-AUTOPILOT.md" target="_blank" rel="noreferrer">Windows delivery contract</a> · <a href="https://github.com/cvsz/zaffiliate/security/code-scanning/2" target="_blank" rel="noreferrer">Security alert #2 (requires GitHub access)</a></p>
        <label htmlFor="autopilot-filter">Filter by delivery state</label>{' '}
        <select id="autopilot-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="ALL">All</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>{' '}
        <button className="btn" type="button" onClick={exportReview}>Export review JSON</button>
      </div>
      {visible.map((feature) => (
        <article className="panel" key={feature.id}>
          <h3>{feature.area}</h3>
          <p><span className="badge">{feature.priority}</span>{' '}<span className="badge pending">{statusLabels[feature.state]}</span></p>
          <p>{feature.detail}</p>
          <p><strong>Acceptance gate:</strong> {feature.gate}</p>
          <label htmlFor={`note-${feature.id}`}>Reviewer notes (local to this page until exported)</label>
          <textarea id={`note-${feature.id}`} rows="2" style={{ display: 'block', width: '100%', marginTop: '0.4rem', padding: '0.5rem', background: '#0b0c10', color: '#c5c6c7', border: '1px solid #45a29e', borderRadius: '0.5rem' }} value={notes[feature.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [feature.id]: event.target.value }))} />
        </article>
      ))}
    </section>
  );
}
