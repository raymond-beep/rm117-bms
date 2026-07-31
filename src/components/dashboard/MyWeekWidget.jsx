// Dashboard "My week" widget — each person's own Weekly-Planner row for the current
// week, read-only, at a glance (Angelena's ask: "each row is a person — can they see
// their schedule on the dashboard?"). Also surfaces the shared "Everyone" lane so a
// firm-wide item (a studio measure-up, an all-hands) reaches every dashboard without
// anyone opening the planner tab.
//
// ⚠️ Rewritten 2026-07-31 when the planner's ink was replaced by checklists: this
// showed a mini ink canvas with a typed-notes overlay, and both of those data sources
// are gone. It now renders the same tasks the planner does, with their done state.
//
// Still READ-ONLY — editing (and ticking) lives in the full planner (/delegation),
// which the "Open planner" link goes to. Boxes here show state; they don't take input.
import React, { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import {
  DAYS, isoDate, addDays, mondayOf, parseISO, weekLabel,
} from '../../lib/delegation-render.js';

const REFRESH_MS = 30000; // the planner polls at 4s; a dashboard glance can be lazier
// Shared "Everyone" lane sentinel — keep in sync with STUDIO_ROW in Delegation.jsx and
// api/delegation.js. Admin-write there; here it's read-only like the rest of the widget.
const STUDIO_ROW = '__studio__';

// One row's strip: five day columns of checklist items. `label` badges the shared
// lane; `emptyText` shows only when the row has nothing at all this week.
function Strip({ tasks, label, variant, emptyText }) {
  const byDay = new Map();
  for (const t of tasks) {
    const arr = byDay.get(t.day_index) || [];
    arr.push(t);
    byDay.set(t.day_index, arr);
  }
  return (
    <div className={`myweek-lane${variant ? ` myweek-lane-${variant}` : ''}`}>
      {label && <div className="myweek-lanelabel">{label}</div>}
      <div className="myweek-strip">
        <div className="myweek-days myweek-taskrow">
          {DAYS.map((_, d) => {
            const items = byDay.get(d) || [];
            return (
              <div key={d} className="myweek-taskcell">
                {items.map((t) => (
                  <div key={t.id} className={`myweek-task${t.done ? ' is-done' : ''}`}>
                    <span className="myweek-taskbox" aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                    <span className="myweek-tasktext">{t.text}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {emptyText && tasks.length === 0 && <div className="myweek-empty">{emptyText}</div>}
      </div>
    </div>
  );
}

export default function MyWeekWidget() {
  const { user } = useUser();
  const myEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase();
  // Defaults to the current week on every mount; ‹ › peek at other weeks (handy on a
  // Friday to see what's next). The full planner still owns editing.
  const thisWeekKey = isoDate(mondayOf(new Date()));
  const [weekKey, setWeekKey] = useState(thisWeekKey);
  const isThisWeek = weekKey === thisWeekKey;
  const [state, setState] = useState({
    status: 'loading', onRoster: false, myTasks: [], studioTasks: [],
  });

  useEffect(() => {
    if (!myEmail) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' })); // clear on week change, not on each 30s poll
    const load = async () => {
      try {
        const r = await apiFetch(`/api/delegation?week=${weekKey}`);
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(data.error || 'Failed to load');
        const onRoster = (data.members || []).some((m) => m.clerk_email === myEmail);
        const tasks = data.tasks || [];
        setState({
          status: 'ready',
          onRoster,
          myTasks: tasks.filter((t) => t.row_owner_email === myEmail),
          studioTasks: tasks.filter((t) => t.row_owner_email === STUDIO_ROW),
        });
      } catch {
        if (alive) setState((s) => ({ ...s, status: 'error' }));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [myEmail, weekKey]);

  const dayDates = DAYS.map((_, i) => addDays(parseISO(weekKey), i).getDate());
  const studioHasContent = state.studioTasks.length > 0;
  // The board is worth showing if the person has a row OR there's a firm-wide item to
  // relay. Only when neither is true do we fall back to the not-on-roster hint.
  const showBoard = state.status === 'ready' && (state.onRoster || studioHasContent);
  const open = state.myTasks.filter((t) => !t.done).length;

  return (
    <div className="card myweek">
      <div className="card-head">
        <h3>My week</h3>
        <div className="myweek-nav">
          <button className="myweek-navbtn" onClick={() => setWeekKey(isoDate(addDays(parseISO(weekKey), -7)))} aria-label="Previous week">‹</button>
          <span className="myweek-weeklabel">{isThisWeek ? 'This week' : weekLabel(weekKey)}</span>
          <button className="myweek-navbtn" onClick={() => setWeekKey(isoDate(addDays(parseISO(weekKey), 7)))} aria-label="Next week">›</button>
          {!isThisWeek && (
            <button className="myweek-today" onClick={() => setWeekKey(thisWeekKey)}>Today</button>
          )}
        </div>
        <Link to="/delegation" className="myweek-open">Open planner ↗</Link>
      </div>

      {state.status === 'loading' && <div className="placeholder-note">Loading your week…</div>}
      {state.status === 'error' && <div className="placeholder-note">Couldn’t load your planner right now.</div>}
      {state.status === 'ready' && !showBoard && (
        <div className="placeholder-note">You’re not on the Weekly Planner yet.</div>
      )}

      {showBoard && (
        <div className="myweek-board">
          {/* The count is the point of a glance — "4 still open" answers the question
              without reading all five columns. Hidden when there is nothing to count. */}
          {state.onRoster && state.myTasks.length > 0 && (
            <div className="myweek-count">
              {open === 0
                ? `All ${state.myTasks.length} done ✓`
                : `${open} still open of ${state.myTasks.length}`}
            </div>
          )}
          <div className="myweek-days">
            {DAYS.map((d, i) => (
              <div key={d} className="myweek-day">
                <span className="myweek-dayname">{d}</span>
                <span className="myweek-daydate">{dayDates[i]}</span>
              </div>
            ))}
          </div>
          {studioHasContent && (
            <Strip tasks={state.studioTasks} label="Everyone" variant="studio" />
          )}
          {state.onRoster && (
            <Strip tasks={state.myTasks} emptyText="Nothing on your planner this week yet." />
          )}
        </div>
      )}
    </div>
  );
}
