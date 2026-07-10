// Dashboard "My week" widget — each person's own Weekly-Planner row for the current
// week, read-only, at a glance (Angelena's ask: "each row is a person — can they see
// their schedule on the dashboard?"). Reuses the planner's ink renderer + week helpers
// so it looks identical to the real board. Editing still lives in the full planner
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

// Read-only mini canvas: paper + day dividers + this person's strokes, DPR-aware and
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

export default function MyWeekWidget() {
  const { user } = useUser();
  const myEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase();
  const weekKey = isoDate(mondayOf(new Date()));
  const [state, setState] = useState({ status: 'loading', strokes: [], notes: [], onRoster: false });

  useEffect(() => {
    if (!myEmail) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const r = await apiFetch(`/api/delegation?week=${weekKey}`);
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(data.error || 'Failed to load');
        const onRoster = (data.members || []).some((m) => m.clerk_email === myEmail);
        setState({
          status: 'ready',
          onRoster,
          strokes: (data.strokes || []).filter((s) => s.row_owner_email === myEmail),
          notes: (data.notes || []).filter((n) => n.row_owner_email === myEmail),
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
  const noteByDay = new Map(state.notes.map((n) => [n.day_index, n.text]));
  const hasContent = state.strokes.length > 0 || state.notes.some((n) => (n.text || '').trim());

  return (
    <div className="card myweek">
      <div className="card-head">
        <h3>My week</h3>
        <span className="head-meta">{weekLabel(weekKey)}</span>
        <Link to="/delegation" className="myweek-open">Open planner ↗</Link>
      </div>

      {state.status === 'loading' && <div className="placeholder-note">Loading your week…</div>}
      {state.status === 'error' && <div className="placeholder-note">Couldn’t load your planner right now.</div>}
      {state.status === 'ready' && !state.onRoster && (
        <div className="placeholder-note">You’re not on the Weekly Planner yet.</div>
      )}

      {state.status === 'ready' && state.onRoster && (
        <div className="myweek-board">
          <div className="myweek-days">
            {DAYS.map((d, i) => (
              <div key={d} className="myweek-day">
                <span className="myweek-dayname">{d}</span>
                <span className="myweek-daydate">{dayDates[i]}</span>
              </div>
            ))}
          </div>
          <div className="myweek-strip">
            <MiniInk strokes={state.strokes} />
            <div className="myweek-notes" style={{ minHeight: MINI_H }}>
              {DAYS.map((_, d) => (
                <div key={d} className="myweek-notecell">{noteByDay.get(d) || ''}</div>
              ))}
            </div>
            {!hasContent && (
              <div className="myweek-empty">Nothing on your planner this week yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
