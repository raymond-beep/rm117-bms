// RM117 Client Portal — client-facing surface (Phase 7).
// Matches the approved "Architectural" mockup (design/visual-refresh-2026-06):
// dark header, project switcher, horizontal phase stepper, and a two-panel
// Documents (vault) + Messages layout. The client signs in with the email on
// file (Clerk, email code — never Google) and sees ONLY their own jobs.
//
// Deliberately money-free: no totals, payments, or balances (see /api/portal/me).
// Documents (Drive file broker) and Messages (thread + email bridge) need their
// backends built — until then their panels render an on-brand empty state.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { shortDate, fileSize, money } from './lib/format.js';
import { hasPortalHint } from './components/shell/portal-gate.jsx';

const fmtMsgTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// Client-facing phase vocabulary — plain English, not the staff BMS shorthand ("CD" reads
// as a compact disc to a homeowner; "Outgoing" means nothing at all).
//
// SUB-PHASES ARE DELIBERATELY ABSENT. Prep/Outgoing and DPI/II/III are an internal
// workload split; telling a client their drawings are "90% done" only invites "so where
// is my set?". Staff see them on the BMS board; clients never do.
//
// 'lead' is absent too — a lead has no portal (they aren't a client until they sign).
// A ladder step can cover SEVERAL stored phases — the firm splits CDs into Prep and
// Outgoing to manage workload, but a client sees one "Construction Drawings" step. They
// don't need to know their drawings are 90% done; it only invites "so where's my set?".
const LADDER = [
  { key: 'potential', label: 'Proposal', phases: ['potential'] },
  { key: 'survey_zoning', label: 'Survey / Zoning', phases: ['survey_zoning'] },
  { key: 'design_phase', label: 'Design', phases: ['design_phase'] },
  { key: 'cd', label: 'Construction Drawings', phases: ['cd_prep', 'cd_outgoing'] },
  { key: 'permitting', label: 'Permitting', phases: ['permitting'] },
  { key: 'construction', label: 'Construction', phases: ['construction'] },
  { key: 'completed', label: 'Complete', phases: ['completed'] },
];
const SHORT_PHASE = {
  lead: 'Lead',
  potential: 'Proposal',
  survey_zoning: 'Survey / Zoning',
  design_phase: 'Design',
  cd_prep: 'Construction Drawings',
  cd_outgoing: 'Construction Drawings',
  permitting: 'Permitting',
  construction: 'Construction',
  on_hold: 'On hold',
  completed: 'Completed',
  job_dropped: 'Closed',
  canceled: 'Canceled',
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

export default function ClientPortal({ client, jobs = [], preview = false }) {
  const clerk = useClerk();
  const { user } = useUser();

  // Which session actually got you in here? A magic-link COOKIE (the normal client path —
  // no Clerk account exists) or a CLERK session (a legacy Clerk-linked client). They need
  // different exits: Clerk's signOut cannot clear our cookie, so keying off `isSignedIn`
  // would leave a Clerk-signed-in staffer stuck in the portal after "signing out".
  const viaCookie = hasPortalHint();
  const signOut = () =>
    viaCookie ? window.location.assign('/api/portal/signout') : clerk.signOut({ redirectUrl: '/' });

  // A STAFF member who clicks a client's magic link becomes that client in this browser —
  // which is genuinely useful (it's how you see what a client sees) but reads as "the app
  // is broken" when you then try to get back to the staff board. Say what's happening and
  // give them the door. Ray hit exactly this the first time he tested a real link.
  const staffEmail = user?.primaryEmailAddress?.emailAddress || '';
  const staffViewing = !preview && viaCookie && staffEmail.endsWith('@rm117.com');

  const [selectedId, setSelectedId] = useState(() => pickDefault(jobs));
  const selected = jobs.find((j) => j.job_id === selectedId) || jobs[0] || null;
  const activeCount = jobs.filter((j) => j.phase !== 'completed').length;
  // Avoid "0 projects" for a client whose work is all completed.
  const projectCount = activeCount || jobs.length;
  const projectWord = `${activeCount ? 'active ' : ''}project${projectCount === 1 ? '' : 's'}`;
  const displayName = client?.company || client?.name || 'Client';

  return (
    <div className={`cp${preview ? ' cp-embedded' : ''}`}>
      {preview && (
        <div className="cp-preview-bar">
          Staff preview — viewing the portal as <strong>{displayName}</strong> ({client?.email || 'no email on file'})
        </div>
      )}
      {/* Staff who followed a client's link: tell them where they are and how to get back,
          instead of letting the staff board look broken. */}
      {staffViewing && (
        <div className="cp-staff-bar">
          <span>
            You followed a client link — you’re seeing this exactly as <strong>{displayName}</strong> does.
          </span>
          <button className="cp-staff-back" onClick={() => window.location.assign('/api/portal/signout')}>
            ← Back to the staff app
          </button>
        </div>
      )}
      <header className="cp-header">
        <div className="cp-head-left">
          <span className="cp-logo">RM117</span>
          <span className="cp-head-divider" />
          <span className="cp-head-eyebrow">Client Portal</span>
        </div>
        <div className="cp-head-right">
          <span className="cp-head-client">{displayName}</span>
          <span className="cp-avatar">{initials(displayName)}</span>
          {preview
            ? <span className="cp-preview-tag">PREVIEW</span>
            : <button className="cp-signout" onClick={signOut}>Sign out</button>}
        </div>
      </header>

      <div className="cp-body">
        <h1 className="cp-welcome">Welcome back, {firstName(client?.name) || displayName}.</h1>
        <p className="cp-sub">
          You have {projectCount} {projectWord} with Room 117 Architecture &amp; Design.
        </p>

        {jobs.length === 0 ? (
          <div className="cp-card cp-empty">
            No projects on file yet — your project manager will be in touch.
          </div>
        ) : (
          <>
            {/* One project (the homeowner) gets the card switcher — it's warmer and there's
                nothing to compare. Several projects (the developer) get a portfolio table:
                the whole book on one screen, rather than clicking through them one by one. */}
            {jobs.length > 1 ? (
              <PortfolioTable jobs={jobs} selectedId={selected?.job_id} onSelect={setSelectedId} />
            ) : (
              <div className="cp-switcher">
                {jobs.map((j) => (
                  <JobCard key={j.job_id} job={j} selected={j.job_id === selected?.job_id} onClick={() => setSelectedId(j.job_id)} />
                ))}
              </div>
            )}

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
  if (phase === 'construction' || phase === 'permitting') return 'green';
  if (phase === 'design_phase' || phase === 'cd_prep' || phase === 'cd_outgoing' || phase === 'survey_zoning') return 'blue';
  if (phase === 'completed') return 'muted';
  if (phase === 'on_hold' || phase === 'job_dropped' || phase === 'canceled') return 'hold';
  return 'default';
}

// Contract total / paid / outstanding for one project. Only the three summary figures
// are sent to the browser — never the payment records themselves.
//
// A "Pay now" button belongs here, but it needs QuickBooks Payments enabled on the
// company (and card fees are ~2.9% — ACH is the sane channel for invoices this size).
// Until that's confirmed, we state the balance and let the client settle it the way
// they already do rather than dangle a button that can't work.
function BillingStrip({ billing }) {
  const { total, paid, outstanding } = billing;
  const settled = outstanding <= 0;
  return (
    <div className="cp-billing">
      <div className="cp-bill-cell">
        <span className="cp-bill-label">Contract total</span>
        <span className="cp-bill-value">{money(total)}</span>
      </div>
      <div className="cp-bill-cell">
        <span className="cp-bill-label">Paid to date</span>
        <span className="cp-bill-value">{money(paid)}</span>
      </div>
      <div className={`cp-bill-cell${settled ? '' : ' owed'}`}>
        <span className="cp-bill-label">{settled ? 'Balance' : 'Outstanding'}</span>
        <span className="cp-bill-value">{settled ? 'Paid in full' : money(outstanding)}</span>
      </div>
    </div>
  );
}

// The developer's view: every project on one screen. Answers "where does everything
// stand, and what do I owe?" without clicking into each job. Doubles as the selector —
// clicking a row loads that project below.
function PortfolioTable({ jobs, selectedId, onSelect }) {
  const owed = jobs.reduce((s, j) => s + Math.max(0, Number(j.billing?.outstanding || 0)), 0);
  const openCount = jobs.filter((j) => j.phase !== 'completed').length;

  return (
    <div className="cp-card cp-portfolio">
      <div className="cp-portfolio-head">
        <span className="cp-portfolio-title">Your projects</span>
        {owed > 0 && (
          <span className="cp-portfolio-owed">
            {money(owed)} outstanding across {openCount} project{openCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="cp-portfolio-scroll">
        <table className="cp-portfolio-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Stage</th>
              <th>Next up</th>
              <th className="cp-num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const [line1] = splitAddr(j.address);
              const bal = Number(j.billing?.outstanding || 0);
              return (
                <tr
                  key={j.job_id}
                  className={j.job_id === selectedId ? 'selected' : ''}
                  onClick={() => onSelect(j.job_id)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(j.job_id); } }}
                >
                  <td>
                    <div className="cp-pf-addr">{line1 || j.title}</div>
                    <div className="cp-pf-id">{j.job_id}</div>
                  </td>
                  <td>
                    <span className={`cp-phase-tone ${phaseTone(j.phase)}`}>{SHORT_PHASE[j.phase] || j.phase}</span>
                  </td>
                  <td className="cp-pf-next">
                    {j.next_milestone_label
                      ? <>{j.next_milestone_label}{j.next_milestone_date && <span className="cp-pf-date"> · {shortDate(j.next_milestone_date)}</span>}</>
                      : <span className="cp-pf-none">—</span>}
                  </td>
                  <td className="cp-num">
                    {j.billing
                      ? (bal > 0 ? <span className="cp-pf-owed">{money(bal)}</span> : <span className="cp-pf-paid">Paid</span>)
                      : <span className="cp-pf-none">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  // A step is "reached" if ANY of the stored phases it covers was reached (CD covers both
  // cd_prep and cd_outgoing).
  const stepReached = (step) => step.phases.some((p) => reachedAt[p]);

  const currentIdx = LADDER.findIndex((s) => s.phases.includes(job.phase));
  const progressIdx = currentIdx >= 0
    ? currentIdx
    : Math.max(-1, ...LADDER.map((s, i) => (stepReached(s) ? i : -1)));
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

      {job.billing && <BillingStrip billing={job.billing} />}

      <div className="cp-stepper">
        <div className="cp-stepper-track" />
        <div className="cp-stepper-fill" style={{ width: `${fillPct}%` }} />
        <div className="cp-stepper-row">
          {LADDER.map((step, i) => {
            const done = completed || i < progressIdx || (onHold && stepReached(step));
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
// One thread per job. Client messages render right ("You"), staff left ("RM117").
// Same component powers the staff preview — there the caller is staff, so a sent
// message posts as staff (a legitimate reply). Email bridge is a later slice.
function MessagesPanel({ job }) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);
  const jobId = job?.job_id;

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const token = await getToken();
      const r = await fetch(`/api/portal/messages?job_id=${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      setMessages(d.messages || []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [jobId, getToken]);

  useEffect(() => { setStatus('loading'); setMessages([]); load(); }, [load]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const token = await getToken();
      const r = await fetch('/api/portal/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ job_id: jobId, body: text }),
      });
      if (!r.ok) throw new Error('send failed');
      const { message } = await r.json();
      setMessages((m) => [...m, message]);
      setDraft('');
    } catch {
      alert('Your message could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cp-card cp-panel cp-messages">
      <div className="cp-panel-head">
        <h3>Messages</h3>
        <span className="cp-panel-tag">{job ? job.job_id : ''}</span>
      </div>
      <div className="cp-panel-body cp-msg-body" ref={bodyRef}>
        {status === 'loading' && <div className="cp-panel-empty">Loading messages…</div>}
        {status === 'error' && <div className="cp-panel-empty">Couldn’t load messages. Try refreshing.</div>}
        {status === 'ready' && messages.length === 0 && (
          <div className="cp-panel-empty">No messages yet. Send a note to your project team below.</div>
        )}
        {status === 'ready' && messages.map((m) => (
          <div key={m.id} className={`cp-msg ${m.sender_type === 'client' ? 'mine' : 'them'}`}>
            <div className="cp-msg-meta">{m.sender_type === 'client' ? 'You' : 'RM117'} · {fmtMsgTime(m.created_at)}</div>
            <div className="cp-msg-bubble">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="cp-composer">
        <input
          className="cp-composer-input"
          placeholder="Write a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="cp-composer-send" onClick={send} disabled={sending || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}
