// New job drawer — create a job (Job ID must match the QBO Customer Display Name).
// The Job ID is assembled from parts (year / auto-suggested next number / last
// name, + the Forefront flag → FF_) with a live preview and validation. An
// "enter manually" escape hatch covers legacy/odd ids.
import React, { useEffect, useMemo, useState } from 'react';
import { PHASE_ORDER, PHASE_LABELS, UNNUMBERED_PHASES } from '../../lib/format.js';
import { currentYY, pad3, nextJobNumberAcross, buildJobId, validateJobId, PLACEHOLDER_NUM } from '../../lib/job-id.js';
import { apiFetch } from '../../lib/api.js';

export default function NewJobDrawer({ onClose, onCreate, jobs = [] }) {
  const existingIds = useMemo(() => new Set(jobs.map((j) => j.job_id)), [jobs]);

  // Job ID builder parts.
  const [yy, setYy] = useState(currentYY());
  const [name, setName] = useState('');

  // Numbers already used in Google Drive for this year — so the suggestion reflects
  // jobs filed in Drive but not yet added to the app (the firm keeps adding to both
  // until the app fully takes over). Refetched when the year changes; on failure or
  // no-Drive we silently fall back to the app-DB-only suggestion.
  const [drive, setDrive] = useState({ numbers: [], loading: true, ok: false });
  useEffect(() => {
    if (!/^\d{2}$/.test(yy)) { setDrive({ numbers: [], loading: false, ok: false }); return undefined; }
    let alive = true;
    setDrive((d) => ({ ...d, loading: true }));
    apiFetch(`/api/jobs/next-number?yy=${yy}`)
      .then((r) => r.json())
      .then((data) => { if (alive) setDrive({ numbers: data.driveNumbers || [], loading: false, ok: data.source === 'drive' }); })
      .catch(() => { if (alive) setDrive({ numbers: [], loading: false, ok: false }); });
    return () => { alive = false; };
  }, [yy]);

  const suggested = useMemo(
    () => pad3(nextJobNumberAcross(jobs, yy, drive.numbers)),
    [jobs, yy, drive.numbers],
  );
  const [nnn, setNnn] = useState(suggested);
  const [nnnEdited, setNnnEdited] = useState(false);
  // Soft advisory: the entered number already exists as a Drive folder for this year
  // (creating it would collide with an existing job filed in Drive).
  const numTakenInDrive = /^\d{3}$/.test(nnn) && drive.numbers.includes(parseInt(nnn, 10));
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
    phase: 'lead',
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

  // An unwon job (Lead / Proposal Sent) carries the PLACEHOLDER number `xxx` — it earns a
  // real sequential number only when the proposal is signed, so leads that fall through
  // don't burn job numbers. Ang's workflow; the promotion happens automatically on the
  // phase change (see api/_lib/job-number.js).
  const unnumbered = UNNUMBERED_PHASES.includes(form.phase);
  const effectiveNnn = unnumbered ? PLACEHOLDER_NUM : nnn;

  const builtId = buildJobId({ yy, nnn: effectiveNnn, forefront: form.is_forefront, name });
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
                      type="text" inputMode="numeric"
                      value={effectiveNnn}
                      onChange={(e) => { setNnnEdited(true); digitsOnly(3)(setNnn)(e); }}
                      placeholder="012" aria-label="Number"
                      disabled={unnumbered}
                      title={unnumbered ? 'Assigned when the proposal is signed' : undefined}
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
                {unnumbered ? (
                  <div className="jobid-hint">
                    No job number yet — this job isn’t won. It takes the next number
                    (<strong>{suggested}</strong>) automatically when you move it past Proposal Sent,
                    and its Drive folder is created then.
                  </div>
                ) : (
                  <>
                    <div className="jobid-hint">
                      Next available for ’{yy}:{' '}
                      <button
                        type="button" className="jobid-link"
                        onClick={() => { setNnnEdited(false); setNnn(suggested); }}
                      >
                        {suggested}
                      </button>
                      {nnnEdited && nnn !== suggested && <span className="jobid-edited"> · using {nnn}</span>}
                      <span className="jobid-source">
                        {drive.loading ? ' · checking Drive…' : drive.ok ? ' · app + Drive' : ' · app only (Drive unavailable)'}
                      </span>
                    </div>
                    {numTakenInDrive && (
                      <div className="jobid-warn">⚠ {yy}_{nnn} already exists in Drive — pick another number.</div>
                    )}
                  </>
                )}
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
