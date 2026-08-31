function required(value, name) {
  const t = String(value ?? '').trim();
  if (!t) throw new Error(`${name} is required`);
  return t;
}

export function createVideoFactory({ clock = () => Date.now() } = {}) {
  const jobs = new Map();
  function createJob({ tenantId, briefId, scriptId, storyboardId, approvalRef } = {}) {
    const tid = required(tenantId, 'tenantId').toLowerCase();
    const jobId = `vf_${String(clock())}_${Math.random().toString(36).slice(2, 8)}`;
    const job = Object.freeze({
      jobId,
      tenantId: tid,
      briefId: required(briefId, 'briefId'),
      scriptId: required(scriptId, 'scriptId'),
      storyboardId: required(storyboardId, 'storyboardId'),
      approvalRef: String(approvalRef ?? '').trim() || null,
      status: 'queued',
      createdAt: new Date(clock()).toISOString(),
      updatedAt: new Date(clock()).toISOString()
    });
    jobs.set(`${tid}:${jobId}`, { ...job, status: 'processing', result: null });
    // immediate placeholder render (FFmpeg deferred — placeholder URL)
    const entry = jobs.get(`${tid}:${jobId}`);
    entry.result = Object.freeze({ url: `https://cdn.zaffiliate.test/videos/${jobId}.mp4`, durationSeconds: 30, placeholder: true });
    entry.status = 'succeeded';
    entry.updatedAt = new Date(clock()).toISOString();
    jobs.set(`${tid}:${jobId}`, entry);
    return Object.freeze({ ...entry });
  }
  function getJob({ tenantId, jobId } = {}) {
    const entry = jobs.get(`${required(tenantId, 'tenantId').toLowerCase()}:${required(jobId, 'jobId')}`);
    return entry ? Object.freeze({ ...entry }) : null;
  }
  function listJobs({ tenantId } = {}) {
    const tid = required(tenantId, 'tenantId').toLowerCase();
    return Object.freeze([...jobs.values()].filter((j) => j.tenantId === tid).map((j) => Object.freeze({ ...j })));
  }
  return Object.freeze({ createJob, getJob, listJobs });
}
