// Drawing QA — pick a job, pick a checkset PDF from that job's Drive "Checksets"
// folder, then review it (analyze against the firm checklist + mark it up). The
// review engine is ported from the standalone Checksets app; the PDF is streamed
// from Drive. See MERGE_PLAN.md in the Checksets repo.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { shortDate, fileSize } from '../../lib/format.js';
import ReviewClient from './ReviewClient.jsx';

export default function DrawingQA() {
  const [jobs, setJobs] = useState(null); // null = loading
  const [jobsError, setJobsError] = useState(null);
  const [jobId, setJobId] = useState('');
  const [active, setActive] = useState(null); // { setId } once a file is opened

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

  const jobOptions = useMemo(() => (jobs || []).filter((j) => j.job_id), [jobs]);

  // Full-screen review overlay (bounded height for tldraw; onBack returns here).
  if (active) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-white">
        <ReviewClient setId={active.setId} onBack={() => setActive(null)} />
      </div>
    );
  }

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
          Pick a job, then choose a drawing set from its Drive “Checksets” folder to review.
        </div>
        {jobsError ? (
          <div className="error">Couldn’t load jobs: {jobsError}</div>
        ) : jobs === null ? (
          <div className="empty">Loading jobs…</div>
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="dqa-job">Job</label>
            <select id="dqa-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
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

      {jobId && <ChecksetFiles jobId={jobId} onOpen={(setId) => setActive({ setId })} />}
    </div>
  );
}

// Lists a job's Checksets-folder PDFs. Clicking "Review" finds-or-creates the
// drawing_sets row for that (job, Drive file) and opens the review engine.
function ChecksetFiles({ jobId, onOpen }) {
  const [state, setState] = useState({ loading: true });
  const [opening, setOpening] = useState(null); // fileId being opened
  const [openErr, setOpenErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    setOpenErr(null);
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

  async function open(file) {
    setOpenErr(null);
    setOpening(file.id);
    try {
      const res = await apiFetch('/api/checksets/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, driveFileId: file.id, filename: file.name, folderId: state.folder }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onOpen(data.set.id);
    } catch (err) {
      setOpenErr(err.message);
    } finally {
      setOpening(null);
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
      {openErr && <div className="error" style={{ marginTop: 6 }}>{openErr}</div>}
      {files.length === 0 ? (
        <div className="empty">No PDFs in this job’s Drive “Checksets” folder yet.</div>
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
              {f.viewable ? (
                <button type="button" className="chip" onClick={() => open(f)} disabled={opening === f.id}>
                  {opening === f.id ? 'Opening…' : 'Review'}
                </button>
              ) : (
                <span className="pdoc-meta">not a PDF</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
