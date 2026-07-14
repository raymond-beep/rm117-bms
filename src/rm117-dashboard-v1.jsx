// RM117 BMS job dashboard (second generation — Supabase-backed via /api).
// Filter/search jobs, a drag-to-organize phase board, JobEditor drawer, and
// new-job creation. Optimistic saves with rollback on error (Phase 3),
// payment logging (Phase 4). `outstanding` always arrives computed from the API.
//
// The board cards, drag helpers, and the JobEditor family live in ./components/
// — this file owns BmsDashboard's state, data loading, and layout.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from './lib/api.js';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  money, phaseLabel, shortDate, fmtDateOnly, addressLine,
  PHASE_LABELS, PHASE_ORDER, PIPELINE_PHASES, BOARD_TABS,
  subPhaseLabel, isStalled, daysInPhase, PHASE_AGE_LIMITS,
} from './lib/format.js';
import { SORT_MODES, orderJobs, findContainer, positionBetween, phaseCollision } from './components/bms/board-helpers.js';
import { JobCardBody } from './components/bms/JobCard.jsx';
import PhaseColumn from './components/bms/PhaseColumn.jsx';
import JobEditor from './components/job-editor/JobEditor.jsx';
import NewJobDrawer from './components/job-editor/NewJobDrawer.jsx';
import DriveInbox from './components/bms/DriveInbox.jsx';

export default function BmsDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  // The board is split into three tabs (Ang's workflow): Job Leads · Pipeline ·
  // In-Construction. Pipeline is the working board and stays the default — leads and
  // construction are organised separately so they don't clutter live design work.
  const [boardTab, setBoardTab] = useState('pipeline');
  const [phaseFilter, setPhaseFilter] = useState('all'); // 'all' = every phase in the tab
  const [ffOnly, setFfOnly] = useState(false);
  const [billOnly, setBillOnly] = useState(false);

  // Drawer state: { mode: 'edit', job } | { mode: 'create' } | null
  const [drawer, setDrawer] = useState(null);

  // View mode: 'grouped' (phase sections) or 'table' (flat sortable)
  const [viewMode, setViewMode] = useState('grouped');

  // Drag-to-move-phase + within-phase reorder (grouped view). Pointer for mouse;
  // touch needs a short press so a tap still opens the card and a swipe scrolls.
  const [sortMode, setSortMode] = useState('manual');
  const [activeId, setActiveId] = useState(null);
  const [dragItems, setDragItems] = useState(null); // working {phase:[jobId]} during a drag
  const [moveError, setMoveError] = useState(null);
  // One-off confirmation, e.g. "this lead just became 26_043_Smith".
  const [notice, setNotice] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  const jobById = useMemo(() => {
    const m = new Map();
    for (const j of jobs) m.set(j.job_id, j);
    return m;
  }, [jobs]);

  // NOTE: `baseItems` + `items` are declared lower, after `filtered`/`scopePhases`
  // exist (they depend on them). The handlers below only read them at drag time.

  function onDragStart(event) {
    setMoveError(null);
    setActiveId(event.active.id);
    setDragItems(structuredClone(baseItems));
  }

  // Live cross-phase move: pull the card into the section under the pointer so
  // the gap opens where it'll land. Intra-phase shuffle is handled by sortable.
  function onDragOver(event) {
    const { active, over } = event;
    if (!over) return;
    setDragItems((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, active.id);
      const to = findContainer(prev, over.id);
      if (!from || !to || from === to) return prev;
      const next = { ...prev, [from]: prev[from].filter((id) => id !== active.id) };
      const overItems = next[to];
      const overIsContainer = over.id in prev;
      const idx = overIsContainer ? overItems.length : Math.max(0, overItems.indexOf(over.id));
      next[to] = [...overItems.slice(0, idx), active.id, ...overItems.slice(idx)];
      return next;
    });
  }

  async function onDragEnd(event) {
    const { active, over } = event;
    const snapshot = dragItems;
    setActiveId(null);
    setDragItems(null);
    if (!over || !snapshot) return;

    const job = jobById.get(active.id);
    const targetPhase = findContainer(snapshot, active.id);
    if (!job || !targetPhase) return;

    // Final id order within the target phase (apply intra-phase reorder).
    let ids = snapshot[targetPhase];
    const overInSame = !(over.id in snapshot) && findContainer(snapshot, over.id) === targetPhase;
    if (overInSame && over.id !== active.id) {
      ids = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    }

    const phaseChanged = job.phase !== targetPhase;
    const reordered = ids.join(',') !== (baseItems[targetPhase] || []).join(',');
    // Reordering within a phase only persists in manual mode (field sorts are views).
    if (!phaseChanged && (!reordered || sortMode !== 'manual')) return;

    const at = ids.indexOf(active.id);
    const fields = { board_position: positionBetween(jobById.get(ids[at - 1]), jobById.get(ids[at + 1])) };
    if (phaseChanged) fields.phase = targetPhase;

    try {
      await saveJob(active.id, fields); // optimistic; API stamps a phase event on a phase change
    } catch (e) {
      setMoveError(`Couldn't move ${active.id}${phaseChanged ? ` to ${PHASE_LABELS[targetPhase]}` : ''}: ${e.message}`);
    }
  }

  async function loadJobs() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch('/api/jobs');
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

  // Arriving from the top-bar global search (`/bms?job=26_001_Deuel`): open that
  // job's editor and switch to the tab that actually holds it, so closing the
  // drawer leaves you looking at the card rather than an unrelated board. The
  // param is consumed (replace, not push) so a refresh or Back doesn't reopen it.
  useEffect(() => {
    const wanted = searchParams.get('job');
    if (!wanted || !jobs.length) return;
    const job = jobs.find((j) => j.job_id === wanted);
    if (job) {
      const tab = BOARD_TABS.find((t) => t.phases.includes(job.phase));
      if (tab) setBoardTab(tab.key);
      setDrawer({ mode: 'edit', job });
    } else {
      setNotice(`Couldn't find ${wanted} — it may have been renamed.`);
    }
    setSearchParams({}, { replace: true });
  }, [jobs, searchParams, setSearchParams]);

  // Phases belonging to the active tab — the board never shows anything outside it.
  const tabPhases = useMemo(
    () => BOARD_TABS.find((t) => t.key === boardTab)?.phases || [],
    [boardTab],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (!tabPhases.includes(j.phase)) return false;
      if (phaseFilter !== 'all' && j.phase !== phaseFilter) return false;
      if (ffOnly && !j.is_forefront) return false;
      if (billOnly && !j.bill_flag) return false;
      if (q) {
        const hay = `${j.job_id} ${j.client_name || ''} ${j.address || ''} ${j.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, search, tabPhases, phaseFilter, ffOnly, billOnly]);

  // Per-tab job counts for the tab strip, and how many jobs have overstayed their phase.
  const tabCounts = useMemo(() => {
    const counts = {};
    for (const t of BOARD_TABS) counts[t.key] = jobs.filter((j) => t.phases.includes(j.phase)).length;
    return counts;
  }, [jobs]);

  const stalled = useMemo(() => jobs.filter((j) => isStalled(j)), [jobs]);

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

  // Phases to show as sections in grouped view. Show every in-scope phase (even
  // empty ones) so each is always a valid drop target — like Ang's Sheet sections.
  const scopePhases = phaseFilter === 'all'
    ? PHASE_ORDER.filter((p) => tabPhases.includes(p))
    : [phaseFilter];

  // Ordered job ids per in-scope phase, for the chosen sort mode. (Declared here,
  // after filtered/scopePhases exist; the drag handlers above read it at drag time.)
  const baseItems = useMemo(() => {
    const map = {};
    for (const phase of scopePhases) {
      map[phase] = orderJobs(filtered.filter((j) => j.phase === phase), sortMode).map((j) => j.job_id);
    }
    return map;
  }, [filtered, scopePhases.join(','), sortMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = dragItems || baseItems;

  // Optimistic save: apply locally, POST, roll back on failure (Phase 3).
  async function saveJob(jobId, fields) {
    const prev = jobs;
    setJobs((js) => js.map((j) => (j.job_id === jobId ? { ...j, ...fields } : j)));
    const res = await apiFetch('/api/jobs/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, fields }),
    });
    if (!res.ok) {
      setJobs(prev); // rollback
      throw new Error((await res.json()).error || `Save failed (HTTP ${res.status})`);
    }
    const out = await res.json();
    // Signing a lead's proposal renames it (26_xxx_Smith → 26_043_Smith), so the row we
    // just patched optimistically is keyed under an id that no longer exists. Reload
    // rather than try to reconcile a moved primary key, close the stale editor, and say
    // plainly what happened — a job silently changing its ID would be alarming.
    if (out.renamed) {
      await loadJobs();
      setDrawer(null);
      const folder = out.renamed.drive?.folderId
        ? ' Drive folder created.'
        : out.renamed.drive?.error
          ? ' (Drive folder could not be created — add it by hand.)'
          : '';
      setNotice(`Proposal signed — ${out.renamed.from} is now ${out.renamed.to}.${folder}`);
    }
    return out;
  }

  async function createJob(fields) {
    const res = await apiFetch('/api/jobs/create', {
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
          <h1 className="greeting">Project Management</h1>
        </div>
        <div className="page-head-actions">
          <div className="view-toggle">
            <button className={'view-btn' + (viewMode === 'grouped' ? ' active' : '')} onClick={() => setViewMode('grouped')}>Grouped</button>
            <button className={'view-btn' + (viewMode === 'table' ? ' active' : '')} onClick={() => setViewMode('table')}>Table</button>
          </div>
          <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'create' })}>+ New Job</button>
        </div>
      </div>

      <DriveInbox onImported={(job) => {
        loadJobs();
        setNotice(`${job.job_id} added from Drive — open it to link the client and set the contract total.`);
      }} />

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

      <div className="board-tabs" role="tablist">
        {BOARD_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={boardTab === t.key}
            className={`board-tab${boardTab === t.key ? ' active' : ''}`}
            onClick={() => { setBoardTab(t.key); setPhaseFilter('all'); }}
          >
            {t.label}
            <span className="board-tab-count">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
        {stalled.length > 0 && (
          <span className="board-stalled" title="Jobs that have overstayed their phase">
            ⚠ {stalled.length} stalled
          </span>
        )}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search job ID, client, address, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="all">All phases in this tab</option>
          {PHASE_ORDER.filter((p) => tabPhases.includes(p)).map((p) => (
            <option key={p} value={p}>{PHASE_LABELS[p]}</option>
          ))}
        </select>
        {viewMode === 'grouped' && (
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} title="Order jobs within each phase">
            {SORT_MODES.map((s) => (
              <option key={s.key} value={s.key}>Sort: {s.label}</option>
            ))}
          </select>
        )}
        <label className="toggle">
          <input type="checkbox" checked={ffOnly} onChange={(e) => setFfOnly(e.target.checked)} /> Forefront
        </label>
        <label className="toggle">
          <input type="checkbox" checked={billOnly} onChange={(e) => setBillOnly(e.target.checked)} /> Bill flag
        </label>
      </div>

      {notice && (
        <div className="board-notice">
          {notice}
          <button className="board-notice-x" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {loading ? (
        <div className="card"><div className="empty">Loading jobs…</div></div>
      ) : loadError ? (
        <div className="card"><div className="empty">Couldn't load jobs: {loadError}</div></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No jobs match the current filters.</div></div>
      ) : viewMode === 'grouped' ? (
        <DndContext sensors={sensors} collisionDetection={phaseCollision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          {moveError && <div className="move-error">{moveError}</div>}
          {sortMode !== 'manual' && (
            <div className="sort-note">Sorted by {SORT_MODES.find((s) => s.key === sortMode)?.label.toLowerCase()} — switch to “Manual order” to drag-reorder within a phase. (Moving between phases still works.)</div>
          )}
          <div className="phase-groups">
            {scopePhases.map((phase) => (
              <PhaseColumn
                key={phase}
                phase={phase}
                ids={items[phase] || []}
                jobById={jobById}
                todayStr={todayStr}
                onOpen={(job) => setDrawer({ mode: 'edit', job })}
              />
            ))}
          </div>
          <DragOverlay>
            {activeId && jobById.get(activeId) ? (
              <div className="job-card job-card-overlay">
                <JobCardBody job={jobById.get(activeId)} todayStr={todayStr} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
                    {job.address && <div className="muted" style={{ fontSize: 12 }}>{addressLine(job.address)}</div>}
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
          onRenamed={() => { setDrawer(null); loadJobs(); }}
        />
      )}
      {drawer?.mode === 'create' && (
        <NewJobDrawer onClose={() => setDrawer(null)} onCreate={createJob} jobs={jobs} />
      )}
    </div>
  );
}
