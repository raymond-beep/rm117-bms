// Progress tab (phase timeline) — set the reached date for each phase and the
// one upcoming "next milestone" date that drives the dashboard "Coming up" feed.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { PHASE_LABELS, PHASE_LADDER } from '../../lib/format.js';
import FieldNotesPanel from './FieldNotesPanel.jsx';

export default function ProgressTab({ job, onSave }) {
  const [events, setEvents] = useState(null);
  const [label, setLabel] = useState(job.next_milestone_label || '');
  const [date, setDate] = useState(job.next_milestone_date ? job.next_milestone_date.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savingPhase, setSavingPhase] = useState(null);

  async function loadEvents() {
    try {
      const res = await apiFetch(`/api/phase-events?job_id=${encodeURIComponent(job.job_id)}`);
      const d = await res.json();
      setEvents(d.events || []);
    } catch {
      setEvents([]);
    }
  }
  useEffect(() => { loadEvents(); }, [job.job_id]);

  // Earliest reached-date per phase, from the append-only event log.
  const reachedByPhase = {};
  for (const e of events || []) {
    if (!reachedByPhase[e.phase]) reachedByPhase[e.phase] = e.entered_at;
  }

  const onHold = job.phase === 'on_hold';
  const canceled = job.phase === 'canceled';
  const terminal = onHold || canceled; // outside the ladder — no phase is "current"
  const currentIdx = PHASE_LADDER.indexOf(job.phase); // -1 when on_hold / canceled

  async function saveMilestone() {
    setSaving(true);
    setError(null);
    try {
      await onSave(job.job_id, {
        next_milestone_label: label || null,
        next_milestone_date: date || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Set or clear the date a given phase was reached (edits the timeline itself,
  // not the upcoming milestone).
  async function setPhaseDate(phase, dateStr) {
    setSavingPhase(phase);
    setError(null);
    try {
      const res = await apiFetch('/api/phase-events', {
        method: dateStr ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dateStr ? { job_id: job.job_id, phase, date: dateStr } : { job_id: job.job_id, phase }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await loadEvents();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPhase(null);
    }
  }

  return (
    <>
      <div className="drawer-body">
        <div className="pay-form-title" style={{ marginTop: 0 }}>Phase progress</div>
        <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
          Set the date each phase was reached (e.g. when you surveyed). For an upcoming deadline to
          track, use “Next milestone” below.
        </div>
        {events === null ? (
          <div className="placeholder-note">Loading timeline…</div>
        ) : (
          <>
            {onHold && <div className="onhold-banner">⏸ This job is currently On Hold.</div>}
            {canceled && <div className="onhold-banner">✕ This job was canceled — kept as a record.</div>}
            <ol className="timeline">
              {PHASE_LADDER.map((p, i) => {
                const reached = reachedByPhase[p];
                const status = terminal
                  ? (reached ? 'done' : 'upcoming')
                  : i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
                return (
                  <li key={p} className={`tl-step ${status}`}>
                    <span className="tl-dot" aria-hidden="true" />
                    <span className="tl-body">
                      <span className="tl-phase">
                        {PHASE_LABELS[p]}
                        {status === 'current' && <span className="tl-now"> · current</span>}
                      </span>
                      <span className="tl-date-row">
                        <input
                          type="date"
                          className="tl-date-input"
                          value={reached ? String(reached).slice(0, 10) : ''}
                          onChange={(e) => setPhaseDate(p, e.target.value)}
                        />
                        {savingPhase === p && <span className="tl-saving">saving…</span>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        <div className="milestone-box">
          <div className="pay-form-title" style={{ margin: '0 0 4px' }}>Next milestone — upcoming date to follow</div>
          <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
            Shows in the dashboard “Coming up” list. This is a future deadline, not a phase date.
          </div>
          <div className="field-row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>What's next</label>
              <input type="text" value={label} placeholder="e.g. CDs due, Permit submitted"
                onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Target date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="milestone-actions">
            {error && <span className="error">{error}</span>}
            <button className="btn btn-primary" onClick={saveMilestone} disabled={saving}>
              {saving ? 'Saving…' : 'Save milestone'}
            </button>
          </div>
        </div>

        <FieldNotesPanel job={job} />
      </div>
    </>
  );
}
