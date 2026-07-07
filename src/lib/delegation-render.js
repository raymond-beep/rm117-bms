// Shared Weekly-Planner rendering + week-date helpers, used by both the full planner
// (src/components/delegation/Delegation.jsx) and the dashboard "My week" widget
// (src/components/dashboard/MyWeekWidget.jsx). Keeping the ink renderer in one place
// means the two stay identical as stroke rendering evolves (e.g. variable-width ink).

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const PAPER = '#fbfbf8';    // the "sheet" stays light in both themes so ink reads
export const GRIDLINE = '#d9d6cc';  // day-column dividers

// --- week-date helpers (all local-time; a board key is the Monday's YYYY-MM-DD) ---
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay();               // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  return addDays(x, diff);
}
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function weekLabel(weekKey) {
  const mon = parseISO(weekKey);
  const fri = addDays(mon, 4);
  const sameMonth = mon.getMonth() === fri.getMonth();
  const left = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`;
  const right = sameMonth ? `${fri.getDate()}` : `${MONTHS[fri.getMonth()]} ${fri.getDate()}`;
  return `${left} – ${right}, ${fri.getFullYear()}`;
}

// Paint the light "paper" surface + the four day-column dividers into a w×h area.
export function paintPaperAndGrid(ctx, w, h) {
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
}

// Render one stroke: normalized 0..1 points → pixels, smoothed with quadratic
// midpoints. Width comes from the stroke's average pressure (per-point pressure is
// stored, so true variable-width ink can be added later without a data migration).
export function drawStroke(ctx, stroke, w, h) {
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
