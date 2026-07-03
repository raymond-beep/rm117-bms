// Drawing QA — Phase A (browse only): pick a job, then pick a checkset PDF from
// that job's Drive "Checksets" folder and preview it. The review engine
// (analyze + markup + save-back-to-Drive) lands in Phase B/C — see MERGE_PLAN.md
// in the Checksets repo.
//
// Auth + Drive access ride the staff-gated backend: /api/jobs (job list) and
// /api/jobs/checkset-files (list + stream a file, brokered through Drive).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { shortDate, fileSize } from '../../lib/format.js';

export default function DrawingQA() {
  const [jobs, setJobs] = useState(null); // null = loading
  const [jobsError, setJobsError] = useState(null);
  const [jobId, setJobId] = useState('');

  // Load the job list once (same endpoint the BMS dashboard uses).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch('/api/jobs');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (alive) setJobs(data.jobs || []);
      } catch (err) {
        if (alive) setJobsError(err.message);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Newest-first, and only jobs with a Job ID (needed to resolve the Drive folder).
  const jobOptions = useMemo(
    () => (jobs || []).filter((j) => j.job_id),
    [jobs],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Drawing QA</div>
          <h1 className="greeting">Checkset review</h1>
        </div>
      </div>

      <div className="card">
        <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
          Pick a job, then choose a drawing set from its Drive “Checksets” folder.
        </div>
        {jobsError ? (
          <div className="error">Couldn’t load jobs: {jobsError}</div>
        ) : jobs === null ? (
          <div className="empty">Loading jobs…</div>
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="dqa-job">Job</label>
            <select
              id="dqa-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">— Select a job —</option>
              {jobOptions.map((j) => (
                <option key={j.job_id} value={j.job_id}>
                  {j.job_id}
                  {j.client?.name ? ` · ${j.client.name}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {jobId && <ChecksetFiles jobId={jobId} />}
    </div>
  );
}

// Lists a job's Checksets-folder PDFs and previews a chosen one inline (blob
// fetched through the staff-gated backend so auth rides the request). Mirrors
// the proposal-docs viewer pattern.
function ChecksetFiles({ jobId }) {
  const [state, setState] = useState({ loading: true });
  const [openId, setOpenId] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewErr, setViewErr] = useState(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    setOpenId(null);
    setBlobUrl(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/jobs/checkset-files?jobId=${encodeURIComponent(jobId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (alive) setState({ loading: false, ...data });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message });
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  // Revoke the blob URL when it's replaced or the panel unmounts.
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  async function view(file) {
    if (openId === file.id) { setOpenId(null); setBlobUrl(null); return; } // toggle closed
    setViewErr(null);
    setViewLoading(true);
    setOpenId(file.id);
    setBlobUrl(null);
    try {
      const res = await apiFetch(
        `/api/jobs/checkset-files?jobId=${encodeURIComponent(jobId)}&fileId=${encodeURIComponent(file.id)}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (!mounted.current) { URL.revokeObjectURL(url); return; }
      setBlobUrl(url);
    } catch (err) {
      if (!mounted.current) return;
      setViewErr(err.message);
      setOpenId(null);
    } finally {
      if (mounted.current) setViewLoading(false);
    }
  }

  if (state.loading) return <div className="card"><div className="empty">Loading drawing sets…</div></div>;
  if (state.error) return <div className="card"><div className="error">{state.error}</div></div>;
  if (state.configured === false) {
    return <div className="card"><div className="empty">Google Drive isn’t configured on the server.</div></div>;
  }

  const files = state.files || [];

  return (
    <div className="card">
      <div className="pay-form-title">Drawing sets</div>
      {files.length === 0 ? (
        <div className="empty">
          No PDFs in this job’s Drive “Checksets” folder yet.
        </div>
      ) : (
        <ul className="pdoc-list">
          {files.map((f) => (
            <li key={f.id} className="pdoc-row">
              <span className="pdoc-icon">▧</span>
              <div className="pdoc-main">
                <span className="pdoc-name">{f.name}</span>
                <span className="pdoc-meta">
                  {[f.modifiedTime && shortDate(f.modifiedTime), fileSize(f.size)].filter(Boolean).join(' · ')}
                </span>
              </div>
              {f.viewable
                ? <button type="button" className="chip" onClick={() => view(f)}>{openId === f.id ? 'Hide' : 'View'}</button>
                : <span className="pdoc-meta">not a PDF</span>}
            </li>
          ))}
        </ul>
      )}

      {viewErr && <div className="error" style={{ marginTop: 8 }}>{viewErr}</div>}
      {openId && (
        <div className="pdoc-viewer">
          {viewLoading ? (
            <div className="empty">Loading drawing set…</div>
          ) : blobUrl ? (
            <>
              <iframe title="Drawing set" src={blobUrl} className="pdoc-frame" />
              <a href={blobUrl} target="_blank" rel="noreferrer" className="chip pdoc-open">Open full screen ↗</a>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
