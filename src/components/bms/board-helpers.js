// BMS board helpers — sort modes + drag-and-drop math for the grouped phase
// board. Pure functions (plus one collision strategy), kept out of the component
// so BmsDashboard stays focused on state + render.
import { pointerWithin, closestCenter } from '@dnd-kit/core';

// Sort options for jobs *within* a phase section. 'manual' = the saved custom
// order (drag to reorder); the rest are computed views that ignore manual order.
export const SORT_MODES = [
  { key: 'manual', label: 'Manual order' },
  { key: 'recent', label: 'Most recent (job #)' },
  { key: 'milestone', label: 'Next milestone' },
  { key: 'value', label: 'Contract value' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'client', label: 'Client name' },
];

const byBoard = (a, b) =>
  (Number.isFinite(a.board_position) ? a.board_position : 1e15) -
  (Number.isFinite(b.board_position) ? b.board_position : 1e15) ||
  String(a.job_id).localeCompare(String(b.job_id));

// Order a phase's jobs for display per the chosen sort mode (manual falls back
// to the saved board_position; field sorts tiebreak on it).
export function orderJobs(list, mode) {
  const jobs = [...list];
  switch (mode) {
    case 'recent':
      // Job IDs are YY_NNN_… so descending = newest first.
      return jobs.sort((a, b) => String(b.job_id).localeCompare(String(a.job_id)));
    case 'milestone':
      return jobs.sort((a, b) => {
        const da = a.next_milestone_date ? String(a.next_milestone_date).slice(0, 10) : '';
        const db = b.next_milestone_date ? String(b.next_milestone_date).slice(0, 10) : '';
        if (!da && !db) return byBoard(a, b);
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db) || byBoard(a, b);
      });
    case 'value':
      return jobs.sort((a, b) => Number(b.job_total || 0) - Number(a.job_total || 0) || byBoard(a, b));
    case 'outstanding':
      return jobs.sort((a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0) || byBoard(a, b));
    case 'client':
      return jobs.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || '') || byBoard(a, b));
    default:
      return jobs.sort(byBoard);
  }
}

// Which phase (container) an id belongs to in an items map; an id that *is* a
// phase key means the container itself (empty area / header).
export function findContainer(itemsMap, id) {
  if (id in itemsMap) return id;
  return Object.keys(itemsMap).find((phase) => itemsMap[phase].includes(id));
}

// A board_position that places a job between its new neighbors (fractional
// midpoint), so only the moved job needs persisting.
export function positionBetween(prevJob, nextJob) {
  const p = prevJob && Number.isFinite(prevJob.board_position) ? prevJob.board_position : null;
  const n = nextJob && Number.isFinite(nextJob.board_position) ? nextJob.board_position : null;
  if (p != null && n != null) return (p + n) / 2;
  if (p != null) return p + 1000;
  if (n != null) return n - 1000;
  return Date.now(); // empty target / null neighbors — unique-ish fallback
}

// Drop on the phase section the pointer is over (header or anywhere inside), so
// you never have to reach its middle. Falls back to the nearest section when the
// pointer is in a gap, so there's always a sensible target.
export function phaseCollision(args) {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
}
