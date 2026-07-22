// Set Check — verify what contractors buy, submit, and count against RM117's
// drawing set. Sibling of Drawing QA (src/components/drawing-qa/); same shape:
// pick a job → pick Drive documents → AI check → a person confirms.
//
// PHASE 1 (2026-07-21): pick a job, then pick the three documents a window check
// compares. The picks are saved on a `set_check_runs` row so returning to the tab
// resumes where you left off. The check engine itself is Phase 2 — see SET_CHECK.md.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { shortDate, fileSize } from '../../lib/format.js';
import JobPicker from '../ui/JobPicker.jsx';

// The three inputs of a window check, and where each normally lives in Drive.
// Deliberately worded as OURS vs THEIRS: the whole check is "what we specified"
// against "what they bought", and confusing the two is the one fatal mistake.
const SLOTS = [
  {
    role: 'schedule',
    field: 'scheduleFileId',
    column: 'schedule_file_id',
    title: 'Our window schedule',
    hint: 'The drawing sheet carrying the window schedule — the size per tag. Usually in Files Sent or Checksets.',
  },
  {
    role: 'rescheck',
    field: 'rescheckFileId',
    column: 'rescheck_file_id',
    title: 'Our REScheck',
    hint: 'The envelope model the permit was based on — the required U-factor. Usually in Files Sent.',
  },
  {
    role: 'submittal',
    field: 'submittalFileId',
    column: 'submittal_file_id',
    title: 'Contractor’s submittal',
    hint: 'The vendor brochure or cut sheet they sent for approval. Usually in Files Received.',
  },
];

export default function SetCheck() {
  const [jobs, setJobs] = useState(null); // null = loading
  const [jobsError, setJobsError] = useState(null);
  const [jobId, setJobId] = useState('');

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Drawing set · compliance &amp; takeoff</div>
          <h1 className="greeting">Set Check</h1>
        </div>
      </div>

      <div className="card">
        <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
          Checks what a contractor bought against what we specified. For windows that is
          two things only — the unit’s <strong>size</strong> against our schedule and its{' '}
          <strong>U-factor</strong> against our REScheck. Series, grille, colour and
          operation are the developer’s choice and are never checked.
        </div>
        {jobsError ? (
          <div className="error">Couldn’t load jobs: {jobsError}</div>
        ) : jobs === null ? (
          <div className="empty">Loading jobs…</div>
        ) : (
          <JobPicker jobs={jobOptions} value={jobId} onChange={setJobId} id="sc-job" />
        )}
      </div>

      {jobId && <RunDocuments key={jobId} jobId={jobId} />}
    </div>
  );
}

// The three document slots for a job's open run. Loads the run and the job's Drive
// PDFs together, then saves each pick straight onto the run.
function RunDocuments({ jobId }) {
  const [run, setRun] = useState(null);
  const [drive, setDrive] = useState(null); // { configured, folder, files, suggested }
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null); // role whose file list is open
  const [saving, setSaving] = useState(null); // role being saved

  useEffect(() => {
    let alive = true;
    setRun(null);
    setDrive(null);
    setError(null);
    setPicking(null);
    (async () => {
      try {
        // The run row and the Drive listing are independent — fetch them together so
        // the slots don't wait on two serial round-trips (Drive is the slow one).
        const [runRes, filesRes] = await Promise.all([
          apiFetch('/api/set-check/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, itemType: 'window' }),
          }),
          apiFetch(`/api/set-check/files?jobId=${encodeURIComponent(jobId)}`),
        ]);
        const runData = await runRes.json().catch(() => ({}));
        if (!runRes.ok) throw new Error(runData.error || `HTTP ${runRes.status}`);
        const filesData = await filesRes.json().catch(() => ({}));
        if (!filesRes.ok) throw new Error(filesData.error || `HTTP ${filesRes.status}`);
        if (!alive) return;
        setRun(runData.run);
        setDrive(filesData);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  async function choose(slot, fileId) {
    setSaving(slot.role);
    setError(null);
    try {
      const res = await apiFetch(`/api/set-check/runs?id=${encodeURIComponent(run.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [slot.field]: fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRun(data.run);
      setPicking(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  if (error && !run) return <div className="card"><div className="error">{error}</div></div>;
  if (!run || !drive) return <div className="card"><div className="empty">Loading documents…</div></div>;
  if (drive.configured === false) {
    return <div className="card"><div className="empty">Google Drive isn’t configured on the server.</div></div>;
  }
  if (!drive.folder) {
    return <div className="card"><div className="empty">This job has no Drive folder yet, so there’s nothing to check.</div></div>;
  }

  const files = drive.files || [];
  const byId = new Map(files.map((f) => [f.id, f]));
  const ready = SLOTS.every((s) => run[s.column]);

  return (
    <div className="card">
      <div className="pay-form-title">Documents to compare</div>
      {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      {files.length === 0 ? (
        <div className="empty">No PDFs in this job’s Drive folders yet.</div>
      ) : (
        <ul className="sc-slots">
          {SLOTS.map((slot) => (
            <Slot
              key={slot.role}
              slot={slot}
              chosen={byId.get(run[slot.column]) || null}
              chosenId={run[slot.column]}
              files={files}
              suggestedId={drive.suggested?.[slot.role] || null}
              open={picking === slot.role}
              saving={saving === slot.role}
              onToggle={() => setPicking(picking === slot.role ? null : slot.role)}
              onPick={(fileId) => choose(slot, fileId)}
            />
          ))}
        </ul>
      )}

      <div className="sc-run-foot">
        {ready ? (
          <span className="sc-ready">✓ All three documents picked — the check engine lands in Phase 2.</span>
        ) : (
          <span className="pdoc-meta">Pick all three documents to enable the check.</span>
        )}
      </div>
    </div>
  );
}

function Slot({ slot, chosen, chosenId, files, suggestedId, open, saving, onToggle, onPick }) {
  // The suggested file floats to the top; everything else keeps the Drive order
  // (newest first). The folder name shown on each row is the real hint — "Files
  // Received" is what tells a staffer a PDF came from the contractor.
  const ordered = useMemo(() => {
    const top = files.find((f) => f.id === suggestedId);
    const rest = files.filter((f) => f.id !== suggestedId);
    return top ? [top, ...rest] : rest;
  }, [files, suggestedId]);

  return (
    <li className={`sc-slot${chosen ? ' is-filled' : ''}`}>
      <div className="sc-slot-head">
        <div className="sc-slot-main">
          <span className="sc-slot-title">{slot.title}</span>
          <span className="sc-slot-hint">{slot.hint}</span>
        </div>
        <button type="button" className="chip" onClick={onToggle} disabled={saving}>
          {saving ? 'Saving…' : open ? 'Cancel' : chosen ? 'Change' : 'Choose'}
        </button>
      </div>

      {chosen ? (
        <div className="sc-slot-file">
          <span className="pdoc-icon">▧</span>
          <div className="pdoc-main">
            <span className="pdoc-name">{chosen.name}</span>
            <span className="pdoc-meta">
              {[chosen.folderName, chosen.modifiedTime && shortDate(chosen.modifiedTime), fileSize(chosen.size)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <button type="button" className="chip" onClick={() => onPick(null)} disabled={saving}>
            Clear
          </button>
        </div>
      ) : chosenId ? (
        // The run points at a file that is no longer in the job's folders (moved or
        // trashed in Drive). Say so rather than silently showing an empty slot.
        <div className="sc-slot-file">
          <span className="pdoc-meta">The document picked earlier is no longer in this job’s Drive folders.</span>
        </div>
      ) : null}

      {open && (
        <ul className="pdoc-list sc-slot-list">
          {ordered.map((f) => (
            <li key={f.id} className="pdoc-row">
              <span className="pdoc-icon">▧</span>
              <div className="pdoc-main">
                <span className="pdoc-name">{f.name}</span>
                <span className="pdoc-meta">
                  {[f.folderName, f.modifiedTime && shortDate(f.modifiedTime), fileSize(f.size)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {f.id === suggestedId && <span className="sc-suggested">Suggested</span>}
              <button type="button" className="chip" onClick={() => onPick(f.id)} disabled={saving}>
                Use
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
