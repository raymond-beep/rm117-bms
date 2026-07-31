// Weekly Planner (/delegation) — the digital version of Angelena's weekly
// hand-drawn delegation sheet. A Mon–Fri × employee grid, one board per week
// (keyed by the Monday date). Everyone sees the same board live (polled), so
// nobody has to ask Angelena what they're on.
//
// Each cell is a CHECKLIST: items you tick off, struck through once done.
//
// ⚠️ **THE PEN WAS REMOVED 2026-07-31** (Ray's call). Ink was Angelena's request
// and she never used it — `delegation_strokes` held 2 rows in the board's whole
// life, against 31 typed notes, every one hers, and she was already writing them
// as one item per line. So this is less a new feature than the board finally
// matching what it was being used for. Migration 0022 turned all 68 of those lines
// into tasks; the ink tables are left in place, unread.
//
// Gone with it: the Pointer-Events canvas, the pen/type mode toggle, the colour
// swatches, and the board zoom — zoom existed purely to make cells big enough to
// HAND-WRITE in, and real text needs no help. Also gone: the whole ink-sync
// cooldown, because a poll can no longer interrupt a pen stroke. The one sync
// guard that remains is "don't clobber a field someone is typing in".
//
// Row-level write permission (your own row; Angelena any row) is enforced
// server-side in api/delegation.js — the UI only mirrors it. Data: /api/delegation.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';
import { DAYS, isoDate, addDays, mondayOf, parseISO, weekLabel } from '../../lib/delegation-render.js';

// Shared "Everyone" lane pinned at the top of the board — a firm-wide item (e.g. a
// measure-up for the whole studio) that admins add once instead of writing it into
// all five people's boxes. Reserved row_owner_email, admin-write only, everyone
// reads it. ⭐ Keep in sync with STUDIO_ROW in api/delegation.js + MyWeekWidget.jsx.
const STUDIO_ROW = '__studio__';
const POLL_MS = 4000; // live-sync cadence

export default function Delegation() {
  const { user } = useUser();
  const myEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase();

  const [weekKey, setWeekKey] = useState(() => isoDate(mondayOf(new Date())));
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [me, setMe] = useState({ email: myEmail, is_admin: false });
  const [status, setStatus] = useState('loading'); // loading | ready | error
  // TWO kinds of error, deliberately separate:
  //   loadError   — the board itself couldn't be fetched. Cleared automatically the
  //                 moment a load succeeds, so it can never contradict the grid
  //                 rendered underneath it.
  //   actionError — a write (add / tick / rename / delete) failed. Stays until
  //                 dismissed, because a 4s poll would otherwise wipe it off the
  //                 screen before anyone had read it.
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  // Lets the poll skip clobbering a field someone is typing in, or a write that
  // hasn't come back yet.
  const editingRef = useRef(false);
  const pendingRef = useRef(0);
  const weekRef = useRef(weekKey);
  weekRef.current = weekKey;

  const load = useCallback(async (wk, { quiet } = {}) => {
    if (!quiet) setStatus('loading');
    try {
      const r = await apiFetch(`/api/delegation?week=${wk}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to load');
      if (weekRef.current !== wk) return; // week changed mid-flight; drop stale result
      // Don't overwrite what someone is mid-way through typing, and don't race a
      // save that hasn't landed — the poll would briefly show the old value back.
      if (!editingRef.current && pendingRef.current === 0) {
        setMembers(data.members || []);
        setMe(data.me || { email: myEmail, is_admin: false });
        setTasks(data.tasks || []);
      }
      // ⚠️ CLEAR on success. Without this, one transient failure — most likely the
      // very first fetch, before the Clerk token is ready — left "Couldn't load the
      // board" pinned above the grid for the rest of the session, contradicting the
      // board sitting underneath it. A stale error is worse than none: it teaches
      // people to ignore the banner.
      setLoadError('');
      setStatus('ready');
    } catch (e) {
      if (weekRef.current === wk) { setLoadError(e.message); setStatus('error'); }
    }
  }, [myEmail]);

  useEffect(() => { load(weekKey); }, [weekKey, load]);

  useEffect(() => {
    const t = setInterval(() => load(weekRef.current, { quiet: true }), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Tasks indexed by "rowEmail|dayIndex" for O(1) per-cell lookup.
  const tasksByCell = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      const key = `${t.row_owner_email}|${t.day_index}`;
      const arr = m.get(key) || [];
      arr.push(t);
      m.set(key, arr);
    }
    return m;
  }, [tasks]);

  const track = async (fn) => {
    pendingRef.current += 1;
    try { return await fn(); } finally { pendingRef.current -= 1; }
  };

  const addTask = useCallback((rowEmail, dayIndex, text) => track(async () => {
    // Optimistic insert with a temp id so a fast typist can keep going without
    // waiting on the round trip. Replaced by the real row on success.
    const tempId = `tmp-${Date.now()}-${Math.random()}`;
    const optimistic = {
      id: tempId, week_key: weekRef.current, row_owner_email: rowEmail,
      day_index: dayIndex, text, done: false, position: Number.MAX_SAFE_INTEGER,
    };
    setTasks((prev) => [...prev, optimistic]);
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekRef.current, row_owner_email: rowEmail, day_index: dayIndex, text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not add that item');
      setTasks((prev) => prev.map((t) => (t.id === tempId ? data.task : t)));
    } catch (e) {
      // Roll the optimistic row back out rather than leaving a ghost item that
      // looks saved and isn't.
      setTasks((prev) => prev.filter((t) => t.id !== tempId));
      setActionError(e.message);
    }
  }), []);

  const setDone = useCallback((task, done) => track(async () => {
    const before = task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done } : t)));
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, done }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not update that item');
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: before } : t)));
      setActionError(e.message);
    }
  }), []);

  const renameTask = useCallback((task, text) => track(async () => {
    if (!text.trim() || text.trim() === task.text) return;
    const before = task.text;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, text } : t)));
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not rename that item');
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, text: before } : t)));
      setActionError(e.message);
    }
  }), []);

  const removeTask = useCallback((task) => track(async () => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Could not remove that item');
      }
    } catch (e) {
      setTasks((prev) => [...prev, task]);
      setActionError(e.message);
    }
  }), []);

  const clearRow = useCallback(async (rowEmail) => {
    const count = DAYS.reduce((n, _, d) => n + (tasksByCell.get(`${rowEmail}|${d}`) || []).length, 0);
    if (!count) return;
    // Clearing a week's row is a handful of items at once and there is no undo,
    // so it asks first — unlike ticking a box, which is trivially reversible.
    if (!window.confirm(`Clear all ${count} item${count === 1 ? '' : 's'} from this row for the week?`)) return;
    await track(async () => {
      const r = await apiFetch('/api/delegation', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekRef.current, row_owner_email: rowEmail, clearRow: true }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setActionError(data.error || 'Could not clear that row');
        return;
      }
      setTasks((prev) => prev.filter((t) => t.row_owner_email !== rowEmail));
    });
  }, [tasksByCell]);

  const isThisWeek = weekKey === isoDate(mondayOf(new Date()));
  const dayDates = useMemo(() => DAYS.map((_, i) => addDays(parseISO(weekKey), i).getDate()), [weekKey]);
  const todayIndex = isThisWeek ? (new Date().getDay() + 6) % 7 : -1; // Mon=0 … Sun=6

  const rowProps = {
    tasksByCell, todayIndex,
    onAdd: addTask, onToggle: setDone, onRename: renameTask, onRemove: removeTask,
    onEditingChange: (v) => { editingRef.current = v; },
  };

  return (
    <div className="page deleg">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 className="greeting">Weekly Planner</h1>
        </div>
      </div>

      <div className="deleg-toolbar">
        <div className="deleg-weeknav">
          <button className="btn" onClick={() => setWeekKey(isoDate(addDays(parseISO(weekKey), -7)))} aria-label="Previous week">‹</button>
          <div className="deleg-weeklabel">
            {weekLabel(weekKey)}
            {isThisWeek && <span className="deleg-thisweek">This week</span>}
          </div>
          <button className="btn" onClick={() => setWeekKey(isoDate(addDays(parseISO(weekKey), 7)))} aria-label="Next week">›</button>
          {!isThisWeek && (
            <button className="btn deleg-today" onClick={() => setWeekKey(isoDate(mondayOf(new Date())))}>Today</button>
          )}
        </div>
      </div>

      {/* Only while the board genuinely isn't loaded. `status` flips back to 'ready'
          and loadError clears on the next successful poll, so this cannot linger
          above a grid that is showing fine. */}
      {status === 'error' && (
        <div className="deleg-error">
          Couldn’t load the board: {loadError} <button className="btn" onClick={() => load(weekKey)}>Retry</button>
        </div>
      )}
      {actionError && (
        <div className="deleg-error">
          {actionError} <button className="btn" onClick={() => setActionError('')}>Dismiss</button>
        </div>
      )}

      <div className="deleg-scroll">
        <div className="deleg-grid">
          <div className="deleg-headrow">
            <div className="deleg-namecell deleg-headcorner" />
            <div className="deleg-days">
              {DAYS.map((d, i) => (
                <div key={d} className={`deleg-day${i === todayIndex ? ' is-today' : ''}`}>
                  <span className="deleg-dayname">{d}</span>
                  <span className="deleg-daydate">{dayDates[i]}</span>
                </div>
              ))}
            </div>
          </div>

          {status === 'loading' && members.length === 0 && (
            <div className="deleg-loading">Loading board…</div>
          )}

          {members.length > 0 && (
            <div className="deleg-row studio">
              <div className="deleg-namecell">
                <div className="deleg-name">Everyone</div>
                <div className="deleg-studiohint">Shared · all staff</div>
                {me.is_admin && (
                  <div className="deleg-rowtools">
                    <button className="deleg-tool" onClick={() => clearRow(STUDIO_ROW)} title="Clear this row for the week">Clear</button>
                  </div>
                )}
              </div>
              <TaskRow rowEmail={STUDIO_ROW} writable={me.is_admin} {...rowProps} />
            </div>
          )}

          {members.map((mem) => {
            const writable = me.is_admin || me.email === mem.clerk_email;
            return (
              <div key={mem.clerk_email} className={`deleg-row${writable ? '' : ' readonly'}`}>
                <div className="deleg-namecell">
                  <div className="deleg-name">{mem.name}</div>
                  {writable && (
                    <div className="deleg-rowtools">
                      <button className="deleg-tool" onClick={() => clearRow(mem.clerk_email)} title="Clear this row for the week">Clear</button>
                    </div>
                  )}
                  {mem.clerk_email === me.email && <div className="deleg-youtag">You</div>}
                </div>
                <TaskRow rowEmail={mem.clerk_email} writable={writable} {...rowProps} />
              </div>
            );
          })}
        </div>
      </div>

      <p className="deleg-foot">
        Add items to your own row{me.is_admin ? ' — and, as admin, to any row' : ''}, then tick them off
        as you go. Press <strong>Enter</strong> to add another straight away. Everyone sees updates
        within a few seconds.
      </p>
    </div>
  );
}

// One person's week: five day cells, each a checklist.
function TaskRow({
  rowEmail, writable, tasksByCell, todayIndex,
  onAdd, onToggle, onRename, onRemove, onEditingChange,
}) {
  return (
    <div className="deleg-days deleg-daycells">
      {DAYS.map((_, day) => (
        <DayCell
          key={day}
          tasks={tasksByCell.get(`${rowEmail}|${day}`) || []}
          isToday={day === todayIndex}
          writable={writable}
          onAdd={(text) => onAdd(rowEmail, day, text)}
          onToggle={onToggle}
          onRename={onRename}
          onRemove={onRemove}
          onEditingChange={onEditingChange}
        />
      ))}
    </div>
  );
}

function DayCell({ tasks, isToday, writable, onAdd, onToggle, onRename, onRemove, onEditingChange }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const commit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
    // Keep focus so a list can be typed straight through — the way Ang actually
    // fills a day (six items, one after another) rather than click-type-click.
    inputRef.current?.focus();
  };

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className={`deleg-cell${isToday ? ' is-today' : ''}`}>
      {tasks.length > 0 && (
        <ul className="deleg-tasks">
          {tasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              writable={writable}
              onToggle={onToggle}
              onRename={onRename}
              onRemove={onRemove}
              onEditingChange={onEditingChange}
            />
          ))}
        </ul>
      )}

      {/* Only once something is finished — an "0 of 0 done" counter on an empty
          day would be noise on 25 cells at once. */}
      {doneCount > 0 && (
        <div className="deleg-cellcount">{doneCount} of {tasks.length} done</div>
      )}

      {writable && (
        <input
          ref={inputRef}
          className="deleg-add"
          placeholder="+ Add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onEditingChange(true)}
          onBlur={() => { onEditingChange(false); commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(''); e.currentTarget.blur(); }
          }}
        />
      )}
    </div>
  );
}

function TaskItem({ task, writable, onToggle, onRename, onRemove, onEditingChange }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.text);

  const stopEditing = (save) => {
    setEditing(false);
    onEditingChange(false);
    if (save) onRename(task, text);
    else setText(task.text);
  };

  if (editing) {
    return (
      <li className="deleg-task is-editing">
        <input
          className="deleg-taskedit"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={() => stopEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); stopEditing(true); }
            if (e.key === 'Escape') { e.preventDefault(); stopEditing(false); }
          }}
        />
      </li>
    );
  }

  return (
    <li className={`deleg-task${task.done ? ' is-done' : ''}`}>
      <label className="deleg-taskmain">
        <input
          type="checkbox"
          className="deleg-taskbox"
          checked={Boolean(task.done)}
          disabled={!writable}
          onChange={(e) => onToggle(task, e.target.checked)}
        />
        <span
          className="deleg-tasktext"
          title={task.done && task.done_by_email ? `Done by ${task.done_by_email}` : undefined}
        >
          {task.text}
        </span>
      </label>
      {writable && (
        <span className="deleg-taskactions">
          <button
            type="button"
            className="deleg-taskbtn"
            title="Edit"
            onClick={() => { setText(task.text); setEditing(true); onEditingChange(true); }}
          >
            ✎
          </button>
          <button type="button" className="deleg-taskbtn is-del" title="Remove" onClick={() => onRemove(task)}>×</button>
        </span>
      )}
    </li>
  );
}
