// Job ID helpers for the New Job builder.
//
// Format: YY_NNN_[FF_]LastName — must match the QuickBooks Customer Display Name
// exactly (the core invariant). JOB_ID_RE mirrors api/_lib/db.js; keep them in
// sync. These are pure functions so they can be unit-tested without the DOM.

// Mirror of api/_lib/db.js JOB_ID_RE (the server is the source of truth).
// Name part may contain internal spaces (legacy/real Job IDs do), no lead/trail space.
export const JOB_ID_RE = /^\d{2}_\d{3}_(FF_)?\S(.*\S)?$/;

// Current year as a 2-digit string ('26').
export function currentYY(now = new Date()) {
  return String(now.getFullYear() % 100).padStart(2, '0');
}

// Pad a job number to the 3-digit NNN form. Numbers >999 are returned as-is
// (4+ digits) so validateJobId can flag the (unlikely) overflow rather than
// silently truncating.
export function pad3(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return String(n ?? '');
  return String(num).padStart(3, '0');
}

// Next free job number for a given 2-digit year: max existing NNN for that year
// + 1 (or 1 if there are none). Accepts an array of job objects or id strings.
export function nextJobNumber(jobs, yy) {
  const prefix = `${yy}_`;
  let max = 0;
  for (const j of jobs || []) {
    const id = typeof j === 'string' ? j : j?.job_id;
    if (typeof id !== 'string' || !id.startsWith(prefix)) continue;
    const m = id.slice(prefix.length).match(/^(\d{3})/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// Next free job number considering BOTH the app's jobs and the numbers already used
// in Google Drive for that year — max(dbMax, driveMax) + 1. Until the app fully takes
// over, jobs are filed in Drive too, so the DB alone can lag behind and suggest a
// number that's already taken in Drive. `driveNumbers` is the NNN list from
// /api/jobs/next-number (may be empty when Drive is unconfigured/unreachable →
// falls back to the DB-only suggestion).
export function nextJobNumberAcross(jobs, yy, driveNumbers = []) {
  const fromDb = nextJobNumber(jobs, yy); // already dbMax + 1
  let driveMax = 0;
  for (const n of driveNumbers || []) {
    const v = Number(n);
    if (Number.isFinite(v)) driveMax = Math.max(driveMax, v);
  }
  return Math.max(fromDb, driveMax + 1);
}

// Assemble a Job ID from the builder parts. Spaces in the name become
// underscores (the format disallows spaces; e.g. "Malanga Subdivide" →
// "Malanga_Subdivide"). Returns '' if any required part is missing.
export function buildJobId({ yy, nnn, forefront, name }) {
  const y = String(yy ?? '').trim();
  const n = String(nnn ?? '').trim();
  const nm = String(name ?? '').trim().replace(/\s+/g, '_');
  if (!y || !n || !nm) return '';
  return `${y}_${n}_${forefront ? 'FF_' : ''}${nm}`;
}

// Validate an assembled/typed Job ID against the format + existing ids.
// existingIds may be a Set or an array. Returns { valid, reason } where reason
// is 'empty' | 'format' | 'duplicate' | null.
export function validateJobId(id, existingIds) {
  if (!id) return { valid: false, reason: 'empty' };
  if (!JOB_ID_RE.test(id)) return { valid: false, reason: 'format' };
  const set = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  if (set.has(id)) return { valid: false, reason: 'duplicate' };
  return { valid: true, reason: null };
}
