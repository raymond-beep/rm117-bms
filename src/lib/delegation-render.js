// Shared Weekly-Planner rendering + week-date helpers, used by both the full planner
// (src/components/delegation/Delegation.jsx) and the dashboard "My week" widget
// (src/components/dashboard/MyWeekWidget.jsx). Keeping the ink renderer in one place
// means the two stay identical as stroke rendering evolves (e.g. variable-width ink).

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

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
// ⚠️ The ink renderers (paintPaperAndGrid / drawStroke) were REMOVED 2026-07-31 when
// the Weekly Planner's pen was replaced by checklists — see api/delegation.js. PAPER
// and GRIDLINE went with them. Only the week-date helpers above are still used, by
// Delegation.jsx and MyWeekWidget.jsx. The old code is in git history if ink ever
// comes back.
