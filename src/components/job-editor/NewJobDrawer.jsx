// New job drawer — create a job (Job ID must match the QBO Customer Display Name).
// The Job ID is assembled from parts (year / auto-suggested next number / last
// name, + the Forefront flag → FF_) with a live preview and validation. An
// "enter manually" escape hatch covers legacy/odd ids.
import React, { useEffect, useMemo, useState } from 'react';
import { PHASE_ORDER, PHASE_LABELS } from '../../lib/format.js';
import { currentYY, pad3, nextJobNumber, buildJobId, validateJobId } from '../../lib/job-id.js';

export default function NewJobDrawer({ onClose, onCreate, jobs = [] }) {
  const existingIds = useMemo(() => new Set(jobs.map((j) => j.job_id)), [jobs]);

  // Job ID builder parts.
  const [yy, setYy] = useState(currentYY());
  const [name, setName] = useState('');
  const suggested = useMemo(() => pad3(nextJobNumber(jobs, yy)), [jobs, yy]);
  const [nnn, setNnn] = useState(suggested);
  const [nnnEdited, setNnnEdited] = useState(false);
  // Keep the number on the suggestion until the user edits it (and re-suggest
  // when the year changes).
  useEffect(() => {
    if (!nnnEdited) setNnn(suggested);
  }, [suggested, nnnEdited]);

  const [manualMode, setManualMode] = useState(false);
  const [manualId, setManualId] = useState('');

  const [form, setForm] = useState({
    client_name: '',
    address: '',
    phase: 'potential',
    job_total: '',
    is_forefront: false,
    ff_commission: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const builtId = buildJobId({ yy, nnn, forefront: form.is_forefront, name });
  const jobId = manualMode ? manualId.trim() : builtId;
  const check = validateJobId(jobId, existingIds);

  const digitsOnly = (max) => (setter) => (e) =>
    setter(e.target.value.replace(/\D/g, '').slice(0, max));

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        job_id: jobId,
        client_name: form.client_name,
        address: form.address,
        phase: form.phase,
        job_total: Number(form.job_total) || 0,
        is_forefront: form.is_forefront,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
        notes: form.notes,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="New job">
        <div className="drawer-head">
          <div>
            <h2>New Job</h2>
            <div className="sub">Job ID must match the QuickBooks Customer Display Name exactly.</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          {/* ── Job ID builder ─────────────────────────────────────────── */}
          <div className="field">
            <label>Job ID — YY_NNN_[FF_]LastName</label>
            {!manualMode ? (
              <>
                <div className="jobid-parts">
                  <div className="jobid-part jobid-part-yy">
                    <span className="jobid-sublabel">Year</span>
                    <input
                      type="text" inputMode="numeric" value={yy}
                      onChange={digitsOnly(2)(setYy)} placeholder="26" aria-label="Year"
                    />
                  </div>
                  <div className="jobid-part jobid-part-nnn">
                    <span className="jobid-sublabel">Number</span>
                    <input
                      type="text" inputMode="numeric" value={nnn}
                      onChange={(e) => { setNnnEdited(true); digitsOnly(3)(setNnn)(e); }}
                      placeholder="012" aria-label="Number"
                    />
                  </div>
                  <div className="jobid-part jobid-part-name">
                    <span className="jobid-sublabel">Last name</span>
                    <input
                      type="text" value={name}
                      onChange={(e) => setName(e.target.value)} placeholder="Smith" aria-label="Last name"
                    />
                  </div>
                </div>
                <div className="jobid-hint">
                  Next available for ’{yy}:{' '}
                  <button
                    type="button" className="jobid-link"
                    onClick={() => { setNnnEdited(false); setNnn(suggested); }}
                  >
                    {suggested}
                  </button>
                  {nnnEdited && nnn !== suggested && <span className="jobid-edited"> · using {nnn}</span>}
                </div>
              </>
            ) : (
              <input
                type="text" value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="26_012_Smith or 26_012_FF_Smith"
                style={{ fontFamily: 'var(--mono)' }}
              />
            )}

            {/* Live preview + validation */}
            <div className={`jobid-preview ${jobId ? (check.valid ? 'ok' : 'bad') : ''}`}>
              <span className="jobid-value">{jobId || '—'}</span>
              {jobId && (
                check.valid
                  ? <span className="jobid-status ok">✓ available</span>
                  : <span className="jobid-status bad">
                      {check.reason === 'duplicate'
                        ? 'already exists'
                        : 'invalid format (YY_NNN_[FF_]LastName)'}
                    </span>
              )}
            </div>

            <button
              type="button" className="jobid-link jobid-toggle"
              onClick={() => setManualMode((m) => !m)}
            >
              {manualMode ? '← Use the builder' : 'Enter ID manually'}
            </button>
          </div>

          <label className="check-field">
            <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
            Forefront job{!manualMode && ' — adds FF_ to the Job ID'}
          </label>
          {form.is_forefront && (
            <div className="field">
              <label>FF commission ($)</label>
              <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} />
            </div>
          )}

          <div className="field">
            <label>Client name</label>
            <input type="text" value={form.client_name} onChange={set('client_name')} />
          </div>
          <div className="field">
            <label>Address</label>
            <input type="text" value={form.address} onChange={set('address')} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Phase</label>
              <select value={form.phase} onChange={set('phase')}>
                {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Job total ($)</label>
              <input type="number" min="0" step="0.01" value={form.job_total} onChange={set('job_total')} />
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <div className="drawer-foot">
          {error && <span className="error">{error}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={saving || !check.valid || !form.client_name}
          >
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </div>
    </>
  );
}
