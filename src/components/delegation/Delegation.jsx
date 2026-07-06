// Delegation Board (/delegation) — the digital version of Angelena's weekly
// hand-drawn delegation sheet. A Mon–Fri × employee grid of Apple-Pencil ink, one
// board per week (keyed by the Monday date). Everyone sees the same board live
// (polled), so nobody has to ask Angelena what they're on.
//
// Ink is captured natively (Pointer Events → HTML5 canvas) — no tldraw / licensed
// canvas SDK. Strokes are stored as normalized 0..1 point arrays so they scale
// across iPad and desktop. Row-level write permission (you draw only your own row;
// Angelena draws any) is enforced server-side in api/delegation.js; the UI just
// mirrors it. Data: /api/delegation.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';

const ROW_H = 150;          // CSS px height of each employee's drawing strip
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const POLL_MS = 4000;       // live-sync cadence (see architecture note in the API)
const PAPER = '#fbfbf8';    // the "sheet" stays light in both themes so ink reads
const GRIDLINE = '#e6e4dd';

// Pen colors — a small fixed swatch set (no full color wheel for v1).
const COLORS = [
  { name: 'Black', hex: '#111111' },
  { name: 'Blue', hex: '#1d4ed8' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Green', hex: '#16a34a' },
];

// --- date helpers (all local-time; the board key is the Monday's YYYY-MM-DD) ---
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay();               // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  return addDays(x, diff);
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function weekLabel(weekKey) {
  const mon = parseISO(weekKey);
  const fri = addDays(mon, 4);
  const sameMonth = mon.getMonth() === fri.getMonth();
  const left = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`;
  const right = sameMonth ? `${fri.getDate()}` : `${MONTHS[fri.getMonth()]} ${fri.getDate()}`;
  return `${left} – ${right}, ${fri.getFullYear()}`;
}

export default function Delegation() {
  const { user } = useUser();
  const myEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase();

  const [weekKey, setWeekKey] = useState(() => isoDate(mondayOf(new Date())));
  const [members, setMembers] = useState([]);
  const [strokes, setStrokes] = useState([]);
  const [notes, setNotes] = useState([]);
  const [me, setMe] = useState({ email: myEmail, is_admin: false });
  const [color, setColor] = useState(COLORS[0].hex);
  const [mode, setMode] = useState('pen'); // 'pen' (draw ink) | 'type' (edit cell notes)
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');

  // Refs let the 4s poll skip clobbering an in-flight draw / unsaved edit.
  const drawingRef = useRef(false);
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
      // While the user is mid-stroke, mid-edit, or a save is pending, apply NOTHING.
      // Any setState here re-renders all five row canvases and hitches the live pen —
      // that's the "it keeps stopping while I write" symptom. Skipping members/me too
      // (not just strokes/notes) means a background poll can't touch an active stroke.
      // setStatus('ready') below is a no-op re-render bailout when already 'ready'.
      if (!drawingRef.current && !editingRef.current && pendingRef.current === 0) {
        setMembers(data.members || []);
        setMe(data.me || { email: myEmail, is_admin: false });
        setStrokes(data.strokes || []);
        setNotes(data.notes || []);
      }
      setStatus('ready');
    } catch (e) {
      if (weekRef.current === wk) { setError(e.message); setStatus('error'); }
    }
  }, [myEmail]);

  // Load on week change.
  useEffect(() => { load(weekKey); }, [weekKey, load]);

  // Live sync: quietly re-fetch the current week on an interval.
  useEffect(() => {
    const t = setInterval(() => load(weekRef.current, { quiet: true }), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const strokesByRow = useMemo(() => {
    const m = new Map();
    for (const s of strokes) {
      const arr = m.get(s.row_owner_email) || [];
      arr.push(s);
      m.set(s.row_owner_email, arr);
    }
    return m;
  }, [strokes]);

  // Typed notes indexed by "rowEmail|dayIndex" for O(1) per-cell lookup.
  const notesByCell = useMemo(() => {
    const m = new Map();
    for (const n of notes) m.set(`${n.row_owner_email}|${n.day_index}`, n);
    return m;
  }, [notes]);

  // Save (or clear, when blank) a typed note for one day cell. Optimistic + reconcile.
  const saveNote = useCallback(async (rowEmail, dayIndex, text) => {
    const trimmed = text.trim();
    const replace = (arr, note) => {
      const others = arr.filter((n) => !(n.row_owner_email === rowEmail && n.day_index === dayIndex));
      return note ? [...others, note] : others;
    };
    setNotes((prev) => replace(prev, trimmed ? {
      id: `temp-${rowEmail}-${dayIndex}`, week_key: weekRef.current, row_owner_email: rowEmail,
      day_index: dayIndex, text: trimmed, created_by_email: me.email, updated_at: new Date().toISOString(),
    } : null));
    pendingRef.current += 1;
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekRef.current, row_owner_email: rowEmail, day_index: dayIndex, text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Save failed');
      setNotes((prev) => replace(prev, data.note));
    } catch (e) { setError(e.message); load(weekRef.current, { quiet: true }); }
    finally { pendingRef.current -= 1; }
  }, [me.email, load]);

  // Commit a finished stroke: paint it optimistically, then persist + reconcile.
  const commitStroke = useCallback(async (rowEmail, points) => {
    const temp = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      week_key: weekRef.current,
      row_owner_email: rowEmail,
      points,
      color,
      created_by_email: me.email,
      _pending: true,
    };
    setStrokes((prev) => [...prev, temp]);
    pendingRef.current += 1;
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekRef.current, row_owner_email: rowEmail, points, color }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Save failed');
      setStrokes((prev) => prev.map((s) => (s.id === temp.id ? data.stroke : s)));
    } catch (e) {
      setStrokes((prev) => prev.filter((s) => s.id !== temp.id)); // roll back
      setError(e.message);
    } finally {
      pendingRef.current -= 1;
    }
  }, [color, me.email]);

  // Undo: remove the last stroke the current user can delete in this row.
  const undoRow = useCallback(async (rowEmail) => {
    const mine = strokes.filter(
      (s) => s.row_owner_email === rowEmail && !s._pending &&
        (me.is_admin || s.created_by_email === me.email),
    );
    const last = mine[mine.length - 1];
    if (!last) return;
    setStrokes((prev) => prev.filter((s) => s.id !== last.id));
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: last.id }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Undo failed');
    } catch (e) { setError(e.message); load(weekRef.current, { quiet: true }); }
  }, [strokes, me, load]);

  const clearRow = useCallback(async (rowEmail) => {
    if (!(strokesByRow.get(rowEmail) || []).length) return;
    if (!window.confirm('Clear this whole row for the week?')) return;
    setStrokes((prev) => prev.filter((s) => s.row_owner_email !== rowEmail));
    try {
      const r = await apiFetch('/api/delegation', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekRef.current, row_owner_email: rowEmail, clearRow: true }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Clear failed');
    } catch (e) { setError(e.message); load(weekRef.current, { quiet: true }); }
  }, [strokesByRow, load]);

  const isThisWeek = weekKey === isoDate(mondayOf(new Date()));
  const dayDates = useMemo(() => DAYS.map((_, i) => addDays(parseISO(weekKey), i).getDate()), [weekKey]);

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
        <div className="deleg-tools">
          <div className="deleg-modes" role="group" aria-label="Pen or type mode">
            <button className={`deleg-mode${mode === 'pen' ? ' active' : ''}`} onClick={() => setMode('pen')} aria-pressed={mode === 'pen'}>✏ Pen</button>
            <button className={`deleg-mode${mode === 'type' ? ' active' : ''}`} onClick={() => setMode('type')} aria-pressed={mode === 'type'}>⌨ Type</button>
          </div>
          <div className={`deleg-colors${mode === 'type' ? ' dim' : ''}`} role="group" aria-label="Pen color">
            {COLORS.map((c) => (
              <button
                key={c.hex}
                className={`deleg-swatch${color === c.hex ? ' active' : ''}`}
                style={{ background: c.hex }}
                onClick={() => setColor(c.hex)}
                aria-label={c.name}
                aria-pressed={color === c.hex}
                title={c.name}
              />
            ))}
          </div>
        </div>
      </div>

      {status === 'error' && (
        <div className="deleg-error">Couldn’t load the board: {error} <button className="btn" onClick={() => load(weekKey)}>Retry</button></div>
      )}

      <div className="deleg-grid">
        <div className="deleg-headrow">
          <div className="deleg-namecell deleg-headcorner" />
          <div className="deleg-days">
            {DAYS.map((d, i) => (
              <div key={d} className="deleg-day">
                <span className="deleg-dayname">{d}</span>
                <span className="deleg-daydate">{dayDates[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {status === 'loading' && members.length === 0 && (
          <div className="deleg-loading">Loading board…</div>
        )}

        {members.map((mem) => {
          const writable = me.is_admin || me.email === mem.clerk_email;
          const rowStrokes = strokesByRow.get(mem.clerk_email) || [];
          return (
            <div key={mem.clerk_email} className={`deleg-row${writable ? '' : ' readonly'}`}>
              <div className="deleg-namecell">
                <div className="deleg-name">{mem.name}</div>
                {writable && (
                  <div className="deleg-rowtools">
                    <button className="deleg-tool" onClick={() => undoRow(mem.clerk_email)} title="Undo last stroke">↶</button>
                    <button className="deleg-tool" onClick={() => clearRow(mem.clerk_email)} title="Clear row">Clear</button>
                  </div>
                )}
                {mem.clerk_email === me.email && <div className="deleg-youtag">You</div>}
              </div>
              <RowCanvas
                strokes={rowStrokes}
                color={color}
                writable={writable}
                mode={mode}
                noteFor={(d) => notesByCell.get(`${mem.clerk_email}|${d}`)}
                onDrawingChange={(v) => { drawingRef.current = v; }}
                onEditingChange={(v) => { editingRef.current = v; }}
                onCommit={(pts) => commitStroke(mem.clerk_email, pts)}
                onSaveNote={(d, text) => saveNote(mem.clerk_email, d, text)}
              />
            </div>
          );
        })}
      </div>

      <p className="deleg-foot">
        You can draw or type in your own row{me.is_admin ? ' — and, as admin, in any row' : ''}. Use <strong>✏ Pen</strong> to ink (Apple Pencil on iPad, mouse on desktop) or <strong>⌨ Type</strong> to click a day and type a note. Everyone sees updates within a few seconds.
      </p>
    </div>
  );
}

// One employee's strip: a canvas that captures native pen/mouse ink over a light
// "paper" surface, with a per-day typed-note overlay on top. Read-only rows still
// render everyone's ink + notes, just without capture/editing. In 'type' mode the
// canvas ignores the pointer so the note textareas receive clicks; in 'pen' mode
// the note layer is click-through so ink draws over the text.
function RowCanvas({ strokes, color, writable, mode, noteFor, onCommit, onDrawingChange, onSaveNote, onEditingChange }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawing = useRef(null); // { points: [{x,y,pressure,t}], color } while active
  const activePointerRef = useRef(null); // pointerId of the pen/mouse that owns the active stroke
  const sizeRef = useRef({ w: 0, h: ROW_H });

  // Paint the paper, gridlines, all committed strokes, and any in-progress stroke.
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { w, h } = sizeRef.current;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // paper + day columns
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = GRIDLINE;
    ctx.lineWidth = 1;
    for (let i = 1; i < DAYS.length; i++) {
      const x = Math.round((w * i) / DAYS.length) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h - 6);
      ctx.stroke();
    }

    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const s of all) drawStroke(ctx, s, w, h);
    ctx.restore();
  }, [strokes]);

  // Size the backing store to the element (DPR-aware) and repaint on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = ROW_H;
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [render]);

  useEffect(() => { render(); }, [strokes, render]);

  const norm = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      t: Date.now(),
    };
  };

  // Palm rejection: the Apple Pencil is a 'pen' pointer; a resting palm is a 'touch'
  // pointer. We only ever draw with the pen (or a desktop mouse), and — critically —
  // once a stroke starts we lock onto that one pointerId. Every later handler ignores
  // any event that isn't from the owning pointer, so a palm's touch up/cancel/leave
  // can't finish (interrupt) the pen stroke that's in progress.
  const onPointerDown = (e) => {
    if (!writable) return;
    if (e.pointerType === 'touch') { e.preventDefault(); return; } // swallow palm; don't draw
    if (drawing.current) return; // already inking with another pointer
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    drawing.current = { points: [norm(e)], color };
    onDrawingChange(true);
    render();
  };
  const onPointerMove = (e) => {
    if (!drawing.current || e.pointerId !== activePointerRef.current) return;
    // Coalesced events give smoother high-frequency pen input where supported.
    const evts = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e];
    for (const ev of evts) drawing.current.points.push(norm(ev.clientX != null ? ev : e));
    render();
  };
  const finish = (e) => {
    if (e) { try { canvasRef.current.releasePointerCapture(e.pointerId); } catch { /* already released */ } }
    activePointerRef.current = null;
    const stroke = drawing.current;
    drawing.current = null;
    onDrawingChange(false);
    if (stroke && stroke.points.length) onCommit(stroke.points);
    render();
  };
  const onPointerUp = (e) => {
    if (!drawing.current || e.pointerId !== activePointerRef.current) return;
    finish(e);
  };

  const typing = mode === 'type';
  return (
    <div className="deleg-canvaswrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="deleg-canvas"
        style={{ touchAction: 'none', pointerEvents: typing ? 'none' : 'auto', cursor: writable ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className={`deleg-notes${typing ? ' typing' : ''}`}>
        {DAYS.map((_, d) => {
          const note = noteFor(d);
          const editable = writable && typing;
          if (editable) {
            return (
              <textarea
                key={`n-${d}-${note?.id || 'empty'}-${note?.updated_at || ''}`}
                className="deleg-notecell edit"
                defaultValue={note?.text || ''}
                placeholder="Add a note…"
                onFocus={() => onEditingChange(true)}
                onBlur={(e) => {
                  onEditingChange(false);
                  const next = e.target.value;
                  if (next.trim() !== (note?.text || '').trim()) onSaveNote(d, next);
                }}
              />
            );
          }
          return (
            <div key={`n-${d}`} className="deleg-notecell">{note?.text || ''}</div>
          );
        })}
      </div>
    </div>
  );
}

// Render one stroke: normalized points → pixels, smoothed with quadratic midpoints.
// Width comes from the stroke's average pressure (per-point pressure is stored, so
// true variable-width ink can be added later without a data migration).
function drawStroke(ctx, stroke, w, h) {
  const pts = stroke.points;
  if (!pts || !pts.length) return;
  const px = pts.map((p) => ({ x: p.x * w, y: p.y * h }));
  const avgP = pts.reduce((s, p) => s + (p.pressure || 0.5), 0) / pts.length;
  ctx.strokeStyle = stroke.color || '#111111';
  ctx.fillStyle = stroke.color || '#111111';
  ctx.lineWidth = 1.2 + avgP * 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (px.length === 1) {
    ctx.beginPath();
    ctx.arc(px[0].x, px[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(px[0].x, px[0].y);
  for (let i = 1; i < px.length - 1; i++) {
    const mx = (px[i].x + px[i + 1].x) / 2;
    const my = (px[i].y + px[i + 1].y) / 2;
    ctx.quadraticCurveTo(px[i].x, px[i].y, mx, my);
  }
  const last = px[px.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}
