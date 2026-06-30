// "Correct Job ID" — renames a job across App + QuickBooks + Drive together.
//
// Deliberately high-friction: you preview exactly what will change, then retype
// the new ID to confirm, before anything is touched. This is the safe alternative
// to a free-text edit (which would rename only the app and desync the other two).
import React, { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { validateJobId } from '../../lib/job-id.js';

const REASONS = {
  empty: 'Enter a Job ID.',
  format: 'Must look like YY_NNN_LastName (e.g. 26_012_Smith). Spaces are allowed inside the name.',
};

export default function CorrectJobIdModal({ job, onClose, onRenamed }) {
  const [newId, setNewId] = useState(job.job_id);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const trimmed = newId.trim();
  const changed = trimmed && trimmed !== job.job_id;
  const fmt = validateJobId(trimmed, []); // format/empty only; backend checks uniqueness
  const formatOk = changed && fmt.valid;

  async function call(dry) {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch('/api/jobs/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_job_id: job.job_id, new_job_id: trimmed, dry_run: dry }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    } finally { setBusy(false); }
  }

  async function doPreview() {
    setError(null); setResult(null); setConfirm('');
    try { setPreview((await call(true)).preview); }
    catch (e) { setError(e.message); setPreview(null); }
  }

  async function doApply() {
    setError(null);
    try {
      const d = await call(false);
      setResult(d.report);
      setTimeout(() => onRenamed(trimmed), 1200); // let them see the result, then refresh
    } catch (e) { setError(e.message); }
  }

  const yn = (b) => (b ? '✓' : '—');

  return (
    <div className="drawer-overlay" style={{ zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg, #fff)', color: 'inherit', maxWidth: 460, width: '92%', borderRadius: 14, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <h3 style={{ margin: '0 0 4px' }}>Correct Job ID</h3>
        <div className="placeholder-note" style={{ padding: '0 0 12px' }}>
          Renames this job everywhere it lives — the app, its QuickBooks customer, and its Google&nbsp;Drive folder — in one step.
        </div>

        <div className="field">
          <label>Current</label>
          <input type="text" value={job.job_id} disabled />
        </div>
        <div className="field">
          <label>New Job ID</label>
          <input type="text" value={newId} onChange={(e) => { setNewId(e.target.value); setPreview(null); setResult(null); }} autoFocus />
          {changed && !fmt.valid && <div className="error" style={{ marginTop: 4 }}>{REASONS[fmt.reason] || 'Invalid Job ID.'}</div>}
        </div>

        {!result && (
          <button className="btn" onClick={doPreview} disabled={!formatOk || busy} style={{ marginBottom: 12 }}>
            {busy && !preview ? 'Checking…' : 'Preview changes'}
          </button>
        )}

        {preview && !result && (
          <div className="rename-preview" style={{ background: 'var(--panel,#f6f6f7)', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>This will change:</div>
            <div>• <strong>App</strong>: the job + {preview.app.total} linked record{preview.app.total === 1 ? '' : 's'} (payments, invoices, notes…)</div>
            <div>• <strong>QuickBooks</strong>: {preview.quickbooks.present
              ? `customer "${job.job_id}" → renamed`
              : preview.quickbooks.configured ? 'no matching customer (nothing to rename)' : 'not connected'}
              {preview.quickbooks.newNameTaken && <span className="error"> — ⚠ a different customer already has the new name</span>}
            </div>
            <div>• <strong>Drive</strong>: {preview.drive.present
              ? (preview.drive.exact ? `folder "${preview.drive.folderName}" → renamed` : `folder "${preview.drive.folderName}" has extra text — rename manually`)
              : preview.drive.configured ? 'no folder found' : 'not connected'}
            </div>
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label>Retype the new ID to confirm</label>
              <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={trimmed} />
            </div>
          </div>
        )}

        {result && (
          <div className="rename-preview" style={{ background: 'var(--panel,#f0fdf4)', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 6 }}>✅ Renamed to {result.new_job_id}</div>
            <div>• App: {result.steps.app}</div>
            <div>• QuickBooks: {result.steps.quickbooks}</div>
            <div>• Drive: {result.steps.drive}</div>
          </div>
        )}

        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>{result ? 'Close' : 'Cancel'}</button>
          {preview && !result && (
            <button className="btn btn-primary" onClick={doApply}
              disabled={busy || confirm.trim() !== trimmed || (preview.quickbooks.present && preview.quickbooks.newNameTaken)}>
              {busy ? 'Renaming…' : 'Apply rename'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
