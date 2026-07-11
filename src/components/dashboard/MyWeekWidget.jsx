// Dashboard "My week" widget — each person's own Weekly-Planner row for the current
// week, read-only, at a glance (Angelena's ask: "each row is a person — can they see
// their schedule on the dashboard?"). Also surfaces the shared "Everyone" lane so a
// firm-wide item (a studio measure-up, an all-hands) reaches every dashboard without
// anyone opening the planner tab. Reuses the planner's ink renderer + week helpers so
// it looks identical to the real board. Editing still lives in the full planner
// (/delegation); the "Open planner" link goes there.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import {
  DAYS, isoDate, addDays, mondayOf, parseISO, weekLabel, drawStroke, paintPaperAndGrid,
} from '../../lib/delegation-render.js';

const MINI_H = 128;          // canvas height for the glance (planner is 150 at 100% zoom)
const REFRESH_MS = 30000;    // the planner polls at 4s; a dashboard glance can be lazier
// Shared "Everyone" lane sentinel — keep in sync with STUDIO_ROW in Delegation.jsx and
// api/delegation.js. Admin-write there; here it's read-only like the rest of the widget.
const STUDIO_ROW = '__studio__';

// Read-only mini canvas: paper + day dividers + a row's strokes, DPR-aware and
// responsive to the card width. No pointer handlers — the full planner owns editing.
function MiniInk({ strokes }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      // The notes layer defines the strip height (grows past MINI_H for long notes); the
      // canvas fills it. Ink is normalized 0..1, so it rescales into the taller strip.
      const h = wrap.clientHeight || MINI_H;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      paintPaperAndGrid(ctx, w, h);
      for (const s of strokes) drawStroke(ctx, s, w, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [strokes]);

  return (
    <div className="myweek-canvaswrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="myweek-canvas" />
    </div>
  );
}

// One row's strip: the ink canvas + typed-notes overlay, matching the planner. `label`
// badges the shared lane; `emptyText` shows only when the row has no content at all.
function Strip({ strokes, notes, label, variant, emptyText }) {
  const noteByDay = new Map(notes.map((n) => [n.day_index, n.text]));
  const hasContent = strokes.length > 0 || notes.some((n) => (n.text || '').trim());
  return (
    <div className={`myweek-lane${variant ? ` myweek-lane-${variant}` : ''}`}>
      {label && <div className="myweek-lanelabel">{label}</div>}
      <div className="myweek-strip">
        <MiniInk strokes={strokes} />
        <div className="myweek-notes" style={{ minHeight: MINI_H }}>
          {DAYS.map((_, d) => (
            <div key={d} className="myweek-notecell">{noteByDay.get(d) || ''}</div>
          ))}
        </div>
        {emptyText && !hasContent && <div className="myweek-empty">{emptyText}</div>}
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
    status: 'loading', onRoster: false,
    myStrokes: [], myNotes: [], studioStrokes: [], studioNotes: [],
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
        const strokes = data.strokes || [];
        const notes = data.notes || [];
        setState({
          status: 'ready',
          onRoster,
          myStrokes: strokes.filter((s) => s.row_owner_email === myEmail),
          myNotes: notes.filter((n) => n.row_owner_email === myEmail),
          studioStrokes: strokes.filter((s) => s.row_owner_email === STUDIO_ROW),
          studioNotes: notes.filter((n) => n.row_owner_email === STUDIO_ROW),
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
  const studioHasContent = state.studioStrokes.length > 0
    || state.studioNotes.some((n) => (n.text || '').trim());
  // The board is worth showing if the person has a row OR there's a firm-wide item to
  // relay. Only when neither is true do we fall back to the not-on-roster hint.
  const showBoard = state.status === 'ready' && (state.onRoster || studioHasContent);

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
          <div className="myweek-days">
            {DAYS.map((d, i) => (
              <div key={d} className="myweek-day">
                <span className="myweek-dayname">{d}</span>
                <span className="myweek-daydate">{dayDates[i]}</span>
              </div>
            ))}
          </div>
          {studioHasContent && (
            <Strip
              strokes={state.studioStrokes}
              notes={state.studioNotes}
              label="Everyone"
              variant="studio"
            />
          )}
          {state.onRoster && (
            <Strip
              strokes={state.myStrokes}
              notes={state.myNotes}
              emptyText="Nothing on your planner this week yet."
            />
          )}
        </div>
      )}
    </div>
  );
}
