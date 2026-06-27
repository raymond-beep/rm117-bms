// Per-job site report (Phase 5) — a clean, printable record of every field note
// for a job, grouped by the phase it was captured in. Opens in its own tab
// (outside the app chrome); "Print / Save as PDF" uses the browser print dialog.
//
// Pulls the job (for the header: client + project address), its field notes, and
// its phase-reached dates, then lays them out chronologically along the phase
// ladder. Screen-only controls (Print / Back) are hidden by @media print.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { PHASE_LABELS, PHASE_LADDER, shortDate, fmtDateOnly } from '../../lib/format.js';

// Ladder order plus on_hold; a trailing "unfiled" bucket catches notes whose
// phase is null (older notes, or a job whose phase wasn't set at capture).
const REPORT_PHASES = [...PHASE_LADDER, 'on_hold'];

function NoteBlock({ note }) {
  const photos = (note.attachments || []).filter((a) => a.type === 'photo' && a.url);
  const voices = (note.attachments || []).filter((a) => a.type === 'voice' && a.url);
  const loc = note.location;
  return (
    <div className="sr-note">
      <div className="sr-note-date">{shortDate(note.created_at)}</div>
      {note.body && <div className="sr-note-body">{note.body}</div>}
      {photos.length > 0 && (
        <div className="sr-photos">
          {photos.map((a, i) => (
            <img key={i} className="sr-photo" src={a.url} alt={a.name || 'Site photo'} />
          ))}
        </div>
      )}
      {voices.length > 0 && (
        <div className="sr-voice">
          {voices.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noreferrer">🎙 Voice memo{voices.length > 1 ? ` ${i + 1}` : ''}</a>
          ))}
        </div>
      )}
      {loc && (
        <div className="sr-loc">
          📍 <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer">
            {loc.address || `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}`}
          </a>
        </div>
      )}
    </div>
  );
}

export default function SiteReport() {
  const { jobId } = useParams();
  const [job, setJob] = useState(undefined); // undefined = loading, null = not found
  const [notes, setNotes] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [jobsRes, notesRes, evRes] = await Promise.all([
          apiFetch('/api/jobs').then((r) => r.json()),
          apiFetch(`/api/field-notes?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
          apiFetch(`/api/phase-events?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
        ]);
        if (!alive) return;
        const found = (jobsRes.jobs || []).find((j) => j.job_id === jobId) || null;
        setJob(found);
        // Oldest → newest reads like a visit log.
        setNotes((notesRes.notes || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
        setEvents(evRes.events || []);
      } catch (e) {
        if (alive) { setError(e.message || 'Could not load the report'); setJob(null); setNotes([]); }
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  if (job === undefined || notes === null) {
    return <div className="sr-wrap"><div className="sr-empty">Loading site report…</div></div>;
  }
  if (error) return <div className="sr-wrap"><div className="sr-empty">{error}</div></div>;
  if (!job) return <div className="sr-wrap"><div className="sr-empty">No job found for “{jobId}”.</div></div>;

  // Group notes by phase; keep any null/unknown-phase notes in a trailing bucket.
  const byPhase = new Map(REPORT_PHASES.map((p) => [p, []]));
  const unfiled = [];
  for (const n of notes) {
    if (n.phase && byPhase.has(n.phase)) byPhase.get(n.phase).push(n);
    else unfiled.push(n);
  }
  const phaseReached = (p) => {
    const ev = events.find((e) => e.phase === p);
    return ev ? fmtDateOnly(ev.entered_at) : null;
  };

  const dates = notes.map((n) => new Date(n.created_at));
  const range = dates.length
    ? `${shortDate(Math.min(...dates))} – ${shortDate(Math.max(...dates))}`
    : '—';

  const sections = REPORT_PHASES
    .map((p) => ({ phase: p, label: PHASE_LABELS[p] || p, reached: phaseReached(p), notes: byPhase.get(p) }))
    .filter((s) => s.notes.length > 0);
  if (unfiled.length) sections.push({ phase: 'unfiled', label: 'Other notes', reached: null, notes: unfiled });

  return (
    <div className="sr-wrap">
      <div className="sr-controls">
        <button className="sr-btn" onClick={() => window.print()}>Print / Save as PDF</button>
        <button className="sr-btn ghost" onClick={() => window.close()}>Close</button>
      </div>

      <div className="sr-page">
        <header className="sr-head">
          <div className="sr-brand">RM117 <span>Architecture &amp; Design</span></div>
          <h1 className="sr-title">Site Report</h1>
          <div className="sr-meta">
            <div><strong>{job.job_id}</strong></div>
            <div>{job.client_name || '—'}</div>
            {job.address && <div>{job.address}</div>}
            <div className="sr-meta-sub">
              {notes.length} note{notes.length === 1 ? '' : 's'} · {range} · generated {shortDate(new Date().toISOString())}
            </div>
          </div>
        </header>

        {sections.length === 0 && <div className="sr-empty">No field notes have been captured for this job yet.</div>}

        {sections.map((s) => (
          <section key={s.phase} className="sr-section">
            <div className="sr-section-head">
              <h2>{s.label}</h2>
              {s.reached && <span className="sr-reached">reached {s.reached}</span>}
            </div>
            {s.notes.map((n) => <NoteBlock key={n.id} note={n} />)}
          </section>
        ))}
      </div>
    </div>
  );
}
