// Drawing QA — pick a job, pick a checkset PDF from that job's Drive "Checksets"
// folder, then review it (analyze against the firm checklist + mark it up). The
// review engine is ported from the standalone Checksets app; the PDF is streamed
// from Drive. See MERGE_PLAN.md in the Checksets repo.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { shortDate, fileSize } from '../../lib/format.js';
import ReviewClient from './ReviewClient.jsx';
import JobPicker from '../ui/JobPicker.jsx';

// Catch any crash in the review engine (e.g. a bad PDF page) so
// it shows an actionable message instead of a dead white screen. Logs the error
// so we can diagnose which file/page triggered it.
class ReviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[drawing-qa] review crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="dqa-review fixed inset-0 z-40 flex flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-1.5 text-sm">
            <button onClick={this.props.onBack} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50">
              ← Files
            </button>
            <span className="font-medium">Couldn’t open this drawing set</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center text-sm text-gray-600">
              <p className="mb-2">Something went wrong rendering this set, so it was stopped instead of showing a blank screen.</p>
              <p className="font-mono text-xs text-gray-500">{String(this.state.error?.message || this.state.error)}</p>
              <button onClick={this.props.onBack} className="mt-4 rounded border border-gray-900 bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700">
                Back to files
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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

  // Full-screen review overlay (onBack returns here).
  if (active) {
    return (
      <ReviewErrorBoundary onBack={() => setActive(null)}>
        <div className="dqa-review fixed inset-0 z-40 flex flex-col">
          <ReviewClient setId={active.setId} onBack={() => setActive(null)} />
        </div>
      </ReviewErrorBoundary>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Checksets</div>
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
          <JobPicker jobs={jobOptions} value={jobId} onChange={setJobId} />
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
        // Cache-buster: the endpoint sets a 60s HTTP cache, but each time we
        // land on this list (e.g. returning from a review where a set was just
        // marked "Reviewed") we want the current statuses, not a stale copy.
        const res = await apiFetch(`/api/jobs/checkset-files?jobId=${encodeURIComponent(jobId)}&t=${Date.now()}`);
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
              {f.reviewStatus === 'reviewed' && (
                <span className="dqa-set-badge is-reviewed">✓ Reviewed</span>
              )}
              {f.reviewStatus === 'in_review' && (
                <span className="dqa-set-badge is-in-review">In review</span>
              )}
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
