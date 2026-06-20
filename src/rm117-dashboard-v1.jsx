// RM117 BMS job dashboard (second generation — Supabase-backed via /api).
// Stat tiles, filter/search jobs table, JobEditor drawer (details + payments),
// new-job creation. Optimistic saves with rollback on error (Phase 3),
// payment logging (Phase 4). `outstanding` always arrives computed from the API.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { money, phaseLabel, shortDate, PHASE_LABELS, PHASE_ORDER, PIPELINE_PHASES } from './lib/format.js';

export default function BmsDashboard() {
  const [jobs, setJobs] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('pipeline');
  const [ffOnly, setFfOnly] = useState(false);
  const [billOnly, setBillOnly] = useState(false);

  // Drawer state: { mode: 'edit', job } | { mode: 'create' } | null
  const [drawer, setDrawer] = useState(null);

  // View mode: 'grouped' (phase sections) or 'table' (flat sortable)
  const [viewMode, setViewMode] = useState('grouped');

  async function loadJobs() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs);
      setSource(data.source);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadJobs(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (phaseFilter === 'pipeline' && !PIPELINE_PHASES.includes(j.phase)) return false;
      if (phaseFilter !== 'all' && phaseFilter !== 'pipeline' && j.phase !== phaseFilter) return false;
      if (ffOnly && !j.is_forefront) return false;
      if (billOnly && !j.bill_flag) return false;
      if (q) {
        const hay = `${j.job_id} ${j.client_name || ''} ${j.address || ''} ${j.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, search, phaseFilter, ffOnly, billOnly]);

  const stats = useMemo(() => {
    const pipeline = jobs.filter((j) => PIPELINE_PHASES.includes(j.phase));
    const outstandingOf = (rows) => rows.reduce((s, j) => s + Math.max(0, Number(j.outstanding || 0)), 0);
    return {
      pipelineCount: pipeline.length,
      pipelineValue: pipeline.reduce((s, j) => s + Number(j.job_total || 0), 0),
      // Active-work balance only; legacy completed/on-hold balances kept separate.
      outstanding: outstandingOf(pipeline),
      legacyOutstanding: outstandingOf(jobs.filter((j) => !PIPELINE_PHASES.includes(j.phase))),
      billFlags: jobs.filter((j) => j.bill_flag).length,
      ffActive: jobs.filter((j) => j.is_forefront && j.phase !== 'completed').length,
      ffOwed: jobs
        .filter((j) => j.is_forefront && !j.ff_commission_paid)
        .reduce((s, j) => s + Number(j.ff_commission || 0), 0),
    };
  }, [jobs]);

  // Jobs with a next-milestone date, soonest first — the dashboard "Coming up" feed.
  const upcoming = useMemo(() => (
    jobs
      .filter((j) => j.next_milestone_date)
      .sort((a, b) => String(a.next_milestone_date).localeCompare(String(b.next_milestone_date)))
      .slice(0, 6)
  ), [jobs]);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Optimistic save: apply locally, POST, roll back on failure (Phase 3).
  async function saveJob(jobId, fields) {
    const prev = jobs;
    setJobs((js) => js.map((j) => (j.job_id === jobId ? { ...j, ...fields } : j)));
    const res = await fetch('/api/jobs/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, fields }),
    });
    if (!res.ok) {
      setJobs(prev); // rollback
      throw new Error((await res.json()).error || `Save failed (HTTP ${res.status})`);
    }
    return res.json();
  }

  async function createJob(fields) {
    const res = await fetch('/api/jobs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error((await res.json()).error || `Create failed (HTTP ${res.status})`);
    await loadJobs();
    return res.json();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">The spine</div>
          <h1 className="greeting">BMS — Job Log</h1>
        </div>
        <div className="page-head-actions">
          <div className="view-toggle">
            <button className={'view-btn' + (viewMode === 'grouped' ? ' active' : '')} onClick={() => setViewMode('grouped')}>Grouped</button>
            <button className={'view-btn' + (viewMode === 'table' ? ' active' : '')} onClick={() => setViewMode('table')}>Table</button>
          </div>
          <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'create' })}>+ New Job</button>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="comingup">
          <div className="comingup-title">Coming up</div>
          <div className="comingup-list">
            {upcoming.map((j) => {
              const overdue = String(j.next_milestone_date).slice(0, 10) < todayStr;
              return (
                <button key={j.job_id} className={`comingup-item${overdue ? ' overdue' : ''}`}
                  onClick={() => setDrawer({ mode: 'edit', job: j })}>
                  <span className="cu-date">{fmtDateOnly(j.next_milestone_date)}</span>
                  <span className="cu-label">{j.next_milestone_label || 'Milestone'}</span>
                  <span className="cu-job">{j.client_name || j.job_id}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search job ID, client, address, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="pipeline">Pipeline (not completed/held)</option>
          <option value="all">All phases</option>
          {PHASE_ORDER.map((p) => (
            <option key={p} value={p}>{PHASE_LABELS[p]}</option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={ffOnly} onChange={(e) => setFfOnly(e.target.checked)} /> Forefront
        </label>
        <label className="toggle">
          <input type="checkbox" checked={billOnly} onChange={(e) => setBillOnly(e.target.checked)} /> Bill flag
        </label>
      </div>

      {loading ? (
        <div className="card"><div className="empty">Loading jobs…</div></div>
      ) : loadError ? (
        <div className="card"><div className="empty">Couldn't load jobs: {loadError}</div></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No jobs match the current filters.</div></div>
      ) : viewMode === 'grouped' ? (
        <div className="phase-groups">
          {PHASE_ORDER.map((phase) => {
            const phaseJobs = filtered.filter((j) => j.phase === phase);
            if (phaseJobs.length === 0) return null;
            return (
              <div key={phase} className="phase-group">
                <div className={`phase-group-header phase-header-${phase}`}>
                  <span className="phase-group-name">{PHASE_LABELS[phase]}</span>
                  <span className="phase-group-count">{phaseJobs.length}</span>
                </div>
                <div className="phase-group-jobs">
                  {phaseJobs.map((job) => (
                    <div key={job.job_id} className="job-card" onClick={() => setDrawer({ mode: 'edit', job })}>
                      <div className="job-card-left">
                        <div className="job-card-id">
                          {job.job_id}
                          {job.is_forefront && <span className="badge badge-ff">FF</span>}
                          {job.bill_flag && <span className="badge badge-bill">BILL</span>}
                        </div>
                        <div className="job-card-client">{job.client_name || <span className="muted">—</span>}</div>
                        {job.address && <div className="job-card-sub">{job.address}</div>}
                        {job.next_milestone_date && (
                          <div className={`job-card-milestone${String(job.next_milestone_date).slice(0, 10) < todayStr ? ' overdue' : ''}`}>
                            ◆ {job.next_milestone_label || 'Next'} · {fmtDateOnly(job.next_milestone_date)}
                          </div>
                        )}
                        {job.last_correspondence && <div className="job-card-corr">{job.last_correspondence}</div>}
                      </div>
                      <div className="job-card-right">
                        <div className="job-card-total">{money(job.job_total)}</div>
                        {Number(job.outstanding) > 0 && (
                          <div className="job-card-outstanding">{money(job.outstanding)} left</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Client</th>
                <th>Phase</th>
                <th className="num">Total</th>
                <th className="num">Outstanding</th>
                <th>Flags</th>
                <th>Last correspondence</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.job_id} onClick={() => setDrawer({ mode: 'edit', job })}>
                  <td className="job-id">{job.job_id}</td>
                  <td>
                    {job.client_name || <span className="muted">—</span>}
                    {job.address && <div className="muted" style={{ fontSize: 12 }}>{job.address}</div>}
                  </td>
                  <td><span className={`badge badge-${job.phase}`}>{phaseLabel(job)}</span></td>
                  <td className="num">{money(job.job_total)}</td>
                  <td className={`num ${Number(job.outstanding) > 0 ? 'outstanding-pos' : 'outstanding-zero'}`}>
                    {money(job.outstanding)}
                  </td>
                  <td>
                    {job.bill_flag && <span className="badge badge-bill">BILL</span>}{' '}
                    {job.is_forefront && <span className="badge badge-ff">FF</span>}{' '}
                    {job.import_needs_review && <span className="review-flag" title={job.import_notes || ''}>⚠ review</span>}
                  </td>
                  <td className="muted">
                    {job.last_correspondence || '—'}
                    {job.last_email_date && <div style={{ fontSize: 12 }}>{shortDate(job.last_email_date)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawer?.mode === 'edit' && (
        <JobEditor
          job={jobs.find((j) => j.job_id === drawer.job.job_id) || drawer.job}
          onClose={() => setDrawer(null)}
          onSave={saveJob}
          onPaymentLogged={loadJobs}
        />
      )}
      {drawer?.mode === 'create' && (
        <NewJobDrawer onClose={() => setDrawer(null)} onCreate={createJob} />
      )}
    </div>
  );
}

/* ============================ JobEditor drawer ============================ */

// Field tags: which fields the client sees in the portal vs internal-only.
const PortalTag = () => <span className="tag-portal" title="Visible to the client in the portal">👁 client</span>;
const InternalTag = () => <span className="tag-internal" title="Internal only — never shown to clients">🔒 internal</span>;

function JobEditor({ job, onClose, onSave, onPaymentLogged }) {
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(() => ({
    client_id: job.client_id || '',
    client_name: job.client_name || '',
    address: job.address || '',
    phase: job.phase,
    phase_override: job.phase_override || '',
    job_total: job.job_total ?? 0,
    bill_flag: Boolean(job.bill_flag),
    is_forefront: Boolean(job.is_forefront),
    ff_commission: job.ff_commission ?? '',
    notes: job.notes || '',
    last_correspondence: job.last_correspondence || '',
  }));
  const [clients, setClients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load the client list for the picker — one identity shared with the portal.
  useEffect(() => {
    let live = true;
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => { if (live) setClients(d.clients || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const linkedClient = clients.find((c) => c.id === form.client_id) || null;

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(job.job_id, {
        ...form,
        client_id: form.client_id || null,
        phase_override: form.phase_override || null,
        job_total: Number(form.job_total) || 0,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
        last_correspondence: form.last_correspondence || null,
        notes: form.notes || null,
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
      <div className="drawer" role="dialog" aria-label={`Edit ${job.job_id}`}>
        <div className="drawer-head">
          <div>
            <h2>{job.job_id}</h2>
            <div className="sub">
              <span className="out">{money(job.outstanding)} outstanding</span> · created {shortDate(job.created_at)}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-tabs">
          <button className={`drawer-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button className={`drawer-tab${tab === 'progress' ? ' active' : ''}`} onClick={() => setTab('progress')}>Progress</button>
          <button className={`drawer-tab${tab === 'payments' ? ' active' : ''}`} onClick={() => setTab('payments')}>Payments</button>
          <button className={`drawer-tab${tab === 'messages' ? ' active' : ''}`} onClick={() => setTab('messages')}>Messages</button>
        </div>

        {tab === 'details' && (
          <>
            <div className="drawer-body">
              <div className="field">
                <label>Linked client <PortalTag /></label>
                <select value={form.client_id} onChange={set('client_id')}>
                  <option value="">— Not linked —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.email ? ` · ${c.email}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {linkedClient ? (
                <div className="client-card">
                  <div className="client-card-row"><span className="ck">Type</span><span className="cv">{linkedClient.type || '—'}</span></div>
                  <div className="client-card-row"><span className="ck">Email</span><span className="cv">{linkedClient.email || '—'}</span></div>
                  <div className="client-card-row"><span className="ck">Phone</span><span className="cv">{linkedClient.phone || '—'}</span></div>
                  {linkedClient.company && <div className="client-card-row"><span className="ck">Company</span><span className="cv">{linkedClient.company}</span></div>}
                  <div className="client-card-note">Shared with the client portal. Edit contact details on the client record.</div>
                </div>
              ) : (
                <div className="placeholder-note">Not linked to a client record — this job won't appear in the client portal. Pick a client above to connect it.</div>
              )}
              <div className="field">
                <label>Display name on this job</label>
                <input type="text" value={form.client_name} onChange={set('client_name')} />
              </div>
              <div className="field">
                <label>Address <PortalTag /></label>
                <input type="text" value={form.address} onChange={set('address')} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Phase <PortalTag /></label>
                  <select value={form.phase} onChange={set('phase')}>
                    {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Phase override (wins if set)</label>
                  <input type="text" value={form.phase_override} onChange={set('phase_override')} placeholder="optional label" />
                </div>
              </div>
              <div className="field-row">
                <div className="field mono-field">
                  <label>Job total ($)</label>
                  <input type="number" min="0" step="0.01" value={form.job_total} onChange={set('job_total')} />
                </div>
                <div className="field mono-field">
                  <label>FF commission ($)</label>
                  <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} disabled={!form.is_forefront} />
                </div>
              </div>
              <label className="check-field">
                <input type="checkbox" checked={form.bill_flag} onChange={set('bill_flag')} />
                Ready to bill
              </label>
              <label className="check-field">
                <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
                Forefront job (carries a commission)
              </label>
              <div className="field">
                <label>Last correspondence</label>
                <input type="text" value={form.last_correspondence} onChange={set('last_correspondence')} />
              </div>
              <div className="field">
                <label>Notes <InternalTag /></label>
                <textarea value={form.notes} onChange={set('notes')} />
              </div>
              {job.import_needs_review && (
                <div className="field">
                  <label className="review-flag">⚠ Import flagged this row for review</label>
                  <div className="placeholder-note">{job.import_notes || 'No import notes recorded.'}</div>
                </div>
              )}
            </div>
            <div className="drawer-foot">
              {error && <span className="error">{error}</span>}
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}

        {tab === 'progress' && (
          <ProgressTab job={job} onSave={onSave} />
        )}

        {tab === 'payments' && (
          <PaymentsTab job={job} onLogged={onPaymentLogged} />
        )}

        {tab === 'messages' && (
          <MessagesTab job={job} />
        )}
      </div>
    </>
  );
}

/* ============================ Messages tab (client thread) ============================ */

// Staff side of the per-job client thread. Reads/posts via the portal endpoints
// (same store the client sees); staff replies post as 'staff' (render as RM117).
function MessagesTab({ job }) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch(`/api/portal/messages?job_id=${encodeURIComponent(job.job_id)}`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      setMessages(d.messages || []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [job.job_id, getToken]);

  useEffect(() => { load(); }, [load]);
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
        body: JSON.stringify({ job_id: job.job_id, body: text }),
      });
      if (!r.ok) throw new Error('send failed');
      const { message } = await r.json();
      setMessages((m) => [...m, message]);
      setDraft('');
    } catch {
      alert('Message could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="drawer-body">
      <p className="hint" style={{ marginTop: 0 }}>
        One thread with the client for this job. Your replies post as <strong>RM117</strong>. Email notifications come later.
      </p>
      <div className="staff-thread" ref={bodyRef}>
        {status === 'loading' && <div className="placeholder-note">Loading messages…</div>}
        {status === 'error' && <div className="placeholder-note">Couldn’t load messages.</div>}
        {status === 'ready' && messages.length === 0 && <div className="placeholder-note">No messages yet.</div>}
        {status === 'ready' && messages.map((m) => (
          <div key={m.id} className={`cp-msg ${m.sender_type === 'staff' ? 'mine' : 'them'}`}>
            <div className="cp-msg-meta">
              {m.sender_type === 'staff' ? 'RM117' : 'Client'} · {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div className="cp-msg-bubble">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="cp-composer staff-composer">
        <input
          className="cp-composer-input"
          placeholder="Reply to the client…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="cp-composer-send" onClick={send} disabled={sending || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}

/* ============================ Progress tab (phase timeline) ============================ */

// Linear progress ladder — 'on_hold' is an orthogonal state, shown separately.
const LADDER = ['potential', 'survey_zoning', 'design_phase', 'cd_phase', 'active', 'completed'];

// Format a date-only string ('YYYY-MM-DD') in local time without a TZ shift.
function fmtDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProgressTab({ job, onSave }) {
  const [events, setEvents] = useState(null);
  const [label, setLabel] = useState(job.next_milestone_label || '');
  const [date, setDate] = useState(job.next_milestone_date ? job.next_milestone_date.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savingPhase, setSavingPhase] = useState(null);

  async function loadEvents() {
    try {
      const res = await fetch(`/api/phase-events?job_id=${encodeURIComponent(job.job_id)}`);
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
  const currentIdx = LADDER.indexOf(job.phase); // -1 when on_hold

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
      const res = await fetch('/api/phase-events', {
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
            <ol className="timeline">
              {LADDER.map((p, i) => {
                const reached = reachedByPhase[p];
                const status = onHold
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

/* ---- Field notes (read-only, staff) — captured on-site via the mobile sheet ---- */
function FieldNotesPanel({ job }) {
  const { getToken } = useAuth();
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/field-notes?job_id=${encodeURIComponent(job.job_id)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (alive) setNotes(d.notes || []);
      } catch {
        if (alive) setNotes([]);
      }
    })();
    return () => { alive = false; };
  }, [job.job_id, getToken]);

  return (
    <div className="fnp">
      <div className="pay-form-title">Field notes</div>
      <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
        Captured on-site from the mobile app (photo, voice, and location). Read-only here.
      </div>
      {notes === null && <div className="placeholder-note">Loading notes…</div>}
      {notes !== null && notes.length === 0 && (
        <div className="placeholder-note">No field notes yet for this job.</div>
      )}
      {notes && notes.map((n) => (
        <div key={n.id} className="fnp-item">
          <div className="fnp-item-head">
            <span className="fnp-date">{shortDate(n.created_at)}</span>
          </div>
          {n.body && <div className="fnp-body">{n.body}</div>}
          {(n.attachments?.length || n.location) && (
            <div className="fn-media">
              {(n.attachments || []).map((a, i) =>
                a.type === 'photo'
                  ? (a.url ? <a key={i} href={a.url} target="_blank" rel="noreferrer"><img className="fn-media-thumb" src={a.url} alt="Field photo" /></a> : null)
                  : (a.url ? <audio key={i} className="fn-media-audio" controls src={a.url} /> : null),
              )}
              {n.location && (
                <a className="fn-media-loc" href={`https://www.google.com/maps?q=${n.location.lat},${n.location.lng}`} target="_blank" rel="noreferrer">
                  📍 {Number(n.location.lat).toFixed(5)}, {Number(n.location.lng).toFixed(5)}
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================ Payments tab (Phase 4) ============================ */

// 'qb' is reserved for the Zapier→Supabase sync; QuickBooks payments arrive
// automatically, so the manual form only offers payments received outside QBO.
const MANUAL_METHODS = ['check', 'venmo', 'zelle', 'cash', 'other'];
const PAY_TYPES = ['retainer', 'dp1', 'dp2', 'dp3', 'cd', 'final', 'other'];

// A payment came from QuickBooks if it carries a QBO invoice id or the qb method.
const isQboPayment = (p) => p.payment_method === 'qb' || Boolean(p.qbo_invoice_id);

function PaymentsTab({ job, onLogged }) {
  const [payments, setPayments] = useState(null);
  const [form, setForm] = useState({
    amount: '',
    payment_method: 'check',
    payment_type: 'other',
    paid_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function loadPayments() {
    const res = await fetch(`/api/payments?job_id=${encodeURIComponent(job.job_id)}`);
    const data = await res.json();
    setPayments(data.payments || []);
  }
  useEffect(() => { loadPayments(); }, [job.job_id]);

  const paid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);

  async function logPayment() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, ...form, amount: Number(form.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setForm((f) => ({ ...f, amount: '', notes: '' }));
      await loadPayments();
      onLogged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-body">
        {payments === null ? (
          <div className="placeholder-note">Loading payments…</div>
        ) : payments.length === 0 ? (
          <div className="placeholder-note">No payments logged for this job yet.</div>
        ) : (
          <>
            <ul className="pay-list">
              {payments.map((p) => (
                <li key={p.id}>
                  <span>
                    <span className="amt">{money(p.amount, { cents: true })}</span>{' '}
                    <span className={`pay-src ${isQboPayment(p) ? 'qbo' : 'ext'}`}>
                      {isQboPayment(p) ? 'QuickBooks' : p.payment_method}
                    </span>
                    <span className="meta"> {p.payment_type.toUpperCase()}</span>
                    {p.qbo_invoice_id && <span className="meta"> · INV {p.qbo_invoice_id}</span>}
                    {p.notes && <div className="meta" style={{ textTransform: 'none', letterSpacing: 0 }}>{p.notes}</div>}
                  </span>
                  <span className="when">{shortDate(p.paid_date)}</span>
                </li>
              ))}
            </ul>
            <div className="pay-total">
              <span>Paid {money(paid, { cents: true })} of {money(job.job_total, { cents: true })}</span>
              <span className={Number(job.job_total) - paid > 0 ? 'left' : 'outstanding-zero'}>
                {money(Number(job.job_total) - paid, { cents: true })} left
              </span>
            </div>
          </>
        )}

        <div className="pay-form-title">Log a payment</div>
        <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
          QuickBooks payments sync automatically — log only payments received outside QuickBooks
          (check, Venmo, Zelle, cash).
        </div>
        <div className="field-row">
          <div className="field">
            <label>Amount ($)</label>
            <input type="number" min="0" step="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.paid_date}
              onChange={(e) => setForm((f) => ({ ...f, paid_date: e.target.value }))} />
          </div>
        </div>
        <div className="field">
          <label>Type</label>
          <div className="chip-row">
            {PAY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${form.payment_type === t ? ' active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, payment_type: t }))}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Method</label>
          <div className="chip-row">
            {MANUAL_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${form.payment_method === m ? ' active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, payment_method: m }))}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div className="drawer-foot">
        {error && <span className="error">{error}</span>}
        <button className="btn btn-primary" onClick={logPayment} disabled={saving || !form.amount}>
          {saving
            ? 'Logging…'
            : `Log ${form.amount ? money(Number(form.amount)) + ' ' : ''}payment`}
        </button>
      </div>
    </>
  );
}

/* ============================ New job drawer ============================ */

function NewJobDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    job_id: '',
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

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        ...form,
        job_total: Number(form.job_total) || 0,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
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
          <div className="field">
            <label>Job ID — YY_NNN_[FF_]LastName</label>
            <input type="text" value={form.job_id} onChange={set('job_id')} placeholder="26_012_Smith or 26_012_FF_Smith" />
          </div>
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
          <label className="check-field">
            <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
            Forefront job
          </label>
          {form.is_forefront && (
            <div className="field">
              <label>FF commission ($)</label>
              <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} />
            </div>
          )}
          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <div className="drawer-foot">
          {error && <span className="error">{error}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.job_id || !form.client_name}>
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </div>
    </>
  );
}
