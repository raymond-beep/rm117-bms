// RM117 Client Portal — client-facing surface (Phase 7).
// Matches the approved "Architectural" mockup (design/visual-refresh-2026-06):
// dark header, project switcher, horizontal phase stepper, and a two-panel
// Documents (vault) + Messages layout. The client signs in with the email on
// file (Clerk, email code — never Google) and sees ONLY their own jobs.
//
// Deliberately money-free: no totals, payments, or balances (see /api/portal/me).
// Documents (Drive file broker) and Messages (thread + email bridge) need their
// backends built — until then their panels render an on-brand empty state.
import React, { useEffect, useState } from 'react';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { shortDate } from './lib/format.js';

// Client-facing phase vocabulary (shorter/friendlier than the staff BMS labels).
const LADDER = [
  { key: 'potential', label: 'Potential' },
  { key: 'survey_zoning', label: 'Survey / Zoning' },
  { key: 'design_phase', label: 'Design' },
  { key: 'cd_phase', label: 'CD' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Complete' },
];
const SHORT_PHASE = {
  potential: 'Potential', survey_zoning: 'Survey / Zoning', design_phase: 'Design',
  cd_phase: 'CD', active: 'Active', on_hold: 'On hold', completed: 'Completed',
};

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const initials = (name) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// "117 Test Lane, Westfield NJ" -> ["117 Test Lane", "Westfield NJ"]
const splitAddr = (addr) => {
  if (!addr) return [null, null];
  const i = addr.indexOf(',');
  return i === -1 ? [addr, null] : [addr.slice(0, i).trim(), addr.slice(i + 1).trim()];
};
const pickDefault = (jobs) =>
  (jobs.find((j) => j.phase !== 'completed' && j.phase !== 'on_hold') || jobs[0])?.job_id;

export default function ClientPortal({ client, jobs = [] }) {
  const clerk = useClerk();
  const [selectedId, setSelectedId] = useState(() => pickDefault(jobs));
  const selected = jobs.find((j) => j.job_id === selectedId) || jobs[0] || null;
  const activeCount = jobs.filter((j) => j.phase !== 'completed').length;
  const displayName = client?.company || client?.name || 'Client';

  return (
    <div className="cp">
      <header className="cp-header">
        <div className="cp-head-left">
          <span className="cp-logo">RM117</span>
          <span className="cp-head-divider" />
          <span className="cp-head-eyebrow">Client Portal</span>
        </div>
        <div className="cp-head-right">
          <span className="cp-head-client">{displayName}</span>
          <span className="cp-avatar">{initials(displayName)}</span>
          <button className="cp-signout" onClick={() => clerk.signOut({ redirectUrl: '/' })}>Sign out</button>
        </div>
      </header>

      <div className="cp-body">
        <h1 className="cp-welcome">Welcome back, {firstName(client?.name) || displayName}.</h1>
        <p className="cp-sub">
          You have {activeCount} {activeCount === 1 ? 'project' : 'projects'} with Room 117 Architecture &amp; Design.
        </p>

        {jobs.length === 0 ? (
          <div className="cp-card cp-empty">
            No projects on file yet — your project manager will be in touch.
          </div>
        ) : (
          <>
            <div className="cp-switcher">
              {jobs.map((j) => (
                <JobCard key={j.job_id} job={j} selected={j.job_id === selected?.job_id} onClick={() => setSelectedId(j.job_id)} />
              ))}
            </div>

            {selected && <JobOverview job={selected} />}

            <div className="cp-panels">
              <DocumentsPanel job={selected} />
              <MessagesPanel job={selected} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function phaseTone(phase) {
  if (phase === 'active') return 'green';
  if (phase === 'design_phase' || phase === 'cd_phase' || phase === 'survey_zoning') return 'blue';
  if (phase === 'completed') return 'muted';
  if (phase === 'on_hold') return 'hold';
  return 'default';
}

function JobCard({ job, selected, onClick }) {
  const [line1, line2] = splitAddr(job.address);
  return (
    <button className={`cp-job-card${selected ? ' selected' : ''}`} onClick={onClick}>
      {job.phase !== 'completed' && job.phase !== 'on_hold' && <span className="cp-active-dot" />}
      <div className="cp-job-addr1">{line1 || job.title}</div>
      {line2 && <div className="cp-job-addr2">{line2}</div>}
      <div className="cp-job-meta">
        {job.job_id} &middot; <span className={`cp-phase-tone ${phaseTone(job.phase)}`}>{SHORT_PHASE[job.phase] || job.phase}</span>
      </div>
    </button>
  );
}

function JobOverview({ job }) {
  const onHold = job.phase === 'on_hold';
  const completed = job.phase === 'completed';
  const [line1] = splitAddr(job.address);

  const reachedAt = {};
  for (const e of job.timeline || []) {
    if (!reachedAt[e.phase] || new Date(e.at) < new Date(reachedAt[e.phase])) reachedAt[e.phase] = e.at;
  }
  const currentIdx = LADDER.findIndex((s) => s.key === job.phase);
  const progressIdx = currentIdx >= 0
    ? currentIdx
    : Math.max(-1, ...LADDER.map((s, i) => (reachedAt[s.key] ? i : -1)));
  // Fill the connector line up to the current step.
  const fillPct = progressIdx <= 0 ? 0 : (progressIdx / (LADDER.length - 1)) * 100;

  const status = onHold ? { cls: 'hold', text: 'On hold' } : { cls: 'track', text: 'On track' };

  return (
    <div className="cp-card cp-overview">
      <div className="cp-overview-head">
        <div>
          <div className="cp-overview-title">{line1 || job.title}</div>
          <div className="cp-overview-sub">
            Room 117 Architecture &amp; Design
            {job.last_update && <> &middot; Last update {shortDate(job.last_update)}</>}
          </div>
        </div>
        <span className={`cp-status ${status.cls}`}>{status.text}</span>
      </div>

      {job.next_milestone_label && (
        <div className="cp-nextup">
          <span className="cp-nextup-label">Next up: {job.next_milestone_label}</span>
          {job.next_milestone_date && <span className="cp-nextup-date">{shortDate(job.next_milestone_date)}</span>}
        </div>
      )}

      <div className="cp-stepper">
        <div className="cp-stepper-track" />
        <div className="cp-stepper-fill" style={{ width: `${fillPct}%` }} />
        <div className="cp-stepper-row">
          {LADDER.map((step, i) => {
            const done = completed || i < progressIdx || (onHold && reachedAt[step.key]);
            const current = !completed && !onHold && i === progressIdx;
            const cls = done ? 'done' : current ? 'current' : 'upcoming';
            return (
              <div key={step.key} className={`cp-step ${cls}`}>
                <span className="cp-step-dot">{done ? '✓' : current ? i + 1 : ''}</span>
                <span className="cp-step-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const fileKind = (name = '', mime = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || mime.includes('pdf')) return 'PDF';
  if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP';
  if (['png', 'jpg', 'jpeg', 'gif', 'heic', 'webp'].includes(ext) || mime.startsWith('image/')) return 'IMG';
  if (['dwg', 'dxf'].includes(ext)) return 'CAD';
  if (['doc', 'docx'].includes(ext) || mime.includes('word')) return 'DOC';
  return (ext || 'FILE').slice(0, 4).toUpperCase();
};
const fileSize = (bytes) => {
  if (!bytes && bytes !== 0) return null;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
};

// Document vault — lists the job's "Files Sent" Drive folder via the backend
// broker (clients never touch Drive). Downloads stream through the API with the
// client's auth token. Uploads (Files Received) are a later slice.
function DocumentsPanel({ job }) {
  const { getToken } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const jobId = job?.job_id;

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/portal/files?job_id=${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        if (alive) setState({ status: 'ready', ...data });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [jobId, getToken]);

  const download = async (file) => {
    try {
      const token = await getToken();
      const r = await fetch(
        `/api/portal/download?job_id=${encodeURIComponent(jobId)}&file_id=${encodeURIComponent(file.id)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!r.ok) throw new Error('download failed');
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(u);
    } catch {
      alert('Sorry — that file could not be downloaded. Please try again.');
    }
  };

  const files = state.files || [];

  return (
    <div className="cp-card cp-panel">
      <div className="cp-panel-head">
        <h3>Documents</h3>
        <span className="cp-panel-tag">VAULT</span>
      </div>
      <div className="cp-panel-body">
        <div className="cp-sublabel">Files sent — download</div>

        {state.status === 'loading' && <div className="cp-panel-empty">Loading documents…</div>}
        {state.status === 'error' && <div className="cp-panel-empty">Couldn’t load documents right now. Try refreshing.</div>}
        {state.status === 'ready' && files.length === 0 && (
          <div className="cp-panel-empty">No documents posted yet. Files your team shares will appear here to download.</div>
        )}
        {state.status === 'ready' && files.map((f) => (
          <button key={f.id} className="cp-file" onClick={() => download(f)}>
            <span className="cp-file-kind">{fileKind(f.name, f.mimeType)}</span>
            <span className="cp-file-main">
              <span className="cp-file-name">{f.name}</span>
              <span className="cp-file-meta">{[fileSize(f.size), f.modified && shortDate(f.modified)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="cp-file-dl">↓</span>
          </button>
        ))}

        <div className="cp-sublabel" style={{ marginTop: 18 }}>Files received — your uploads</div>
        <div className="cp-dropzone is-soon">Uploads coming soon</div>
      </div>
    </div>
  );
}

// Messaging — backend (thread + email bridge) not built yet. On-brand empty state.
function MessagesPanel({ job }) {
  return (
    <div className="cp-card cp-panel cp-messages">
      <div className="cp-panel-head">
        <h3>Messages</h3>
        <span className="cp-panel-tag">{job ? job.job_id : ''}</span>
      </div>
      <div className="cp-panel-body cp-msg-body">
        <div className="cp-panel-empty">No messages yet. You'll be able to message your project team here — one thread per project, bridged to email.</div>
      </div>
      <div className="cp-composer is-soon">
        <div className="cp-composer-input">Messaging coming soon…</div>
        <button className="cp-composer-send" disabled>Send</button>
      </div>
    </div>
  );
}
