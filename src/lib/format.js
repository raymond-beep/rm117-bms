// Shared display helpers — phase vocabulary and money formatting.

// ---------------------------------------------------------------------------
// Job phases — Angelena's workflow (mapped out 2026-07-13; see PHASE_MODEL.md).
//
// A job runs: Lead → Proposal Sent → Survey/Zoning → Design → CD → Permitting →
// Construction → Completed, with two branches off the main line (Job Dropped when a
// proposal is rejected, Canceled when a SIGNED job is terminated early) and On Hold
// as a pause.
//
// SUB-PHASES: two phases are split internally to manage workload —
//   Design Phase → DPI / DPII / DPIII  (how many is set by the proposal, so it varies)
//   CD Phase     → Prep / Outgoing     (Outgoing = 90% done, must wrap up)
// Sub-phases are an INTERNAL workload tool. Clients never see them.
//
// The phase set must stay in sync with `PHASES` in api/_lib/db.js and the
// jobs.phase / field_notes.phase CHECK constraints (migration 0011).
// ---------------------------------------------------------------------------

export const PHASE_LABELS = {
  lead: 'Lead',
  potential: 'Proposal Sent',
  job_dropped: 'Job Dropped',
  survey_zoning: 'Survey + Zoning Analysis + Schematics',
  design_phase: 'Design Phase',
  cd_prep: 'CD — Prep',
  cd_outgoing: 'CD — Outgoing',
  permitting: 'Permitting',
  construction: 'Construction',
  on_hold: 'On Hold',
  completed: 'Completed',
  canceled: 'Canceled',
};

// The two halves of the CD stage. Grouped for the places that still care about "is this
// job in CDs?" (the 3-week aging rule, the client-facing ladder — a client sees one
// "Construction Drawings" step, not Ang's internal workload split).
export const CD_PHASES = ['cd_prep', 'cd_outgoing'];

// ---- Sub-phases ----------------------------------------------------------
// Only Design has sub-phases now: DPI/II/III vary per job (the proposal sets how many),
// so they can't be a fixed set of board sections the way CD's two piles can.
// A job's `sub_phase` must be one of its phase's list (or null).
export const SUB_PHASES = {
  design_phase: ['dp1', 'dp2', 'dp3'],
};

export const SUB_PHASE_LABELS = {
  dp1: 'DPI',
  dp2: 'DPII',
  dp3: 'DPIII',
};

// Design sub-phases are capped per job by the proposal (`design_phase_count`).
// A job with 2 design phases shows DPI → DPII and nothing more.
export function subPhasesFor(job) {
  const all = SUB_PHASES[job?.phase] || [];
  if (job?.phase !== 'design_phase') return all;
  const n = Number(job?.design_phase_count);
  return n > 0 ? all.slice(0, Math.min(n, all.length)) : all;
}

export function subPhaseLabel(job) {
  return job?.sub_phase ? SUB_PHASE_LABELS[job.sub_phase] || job.sub_phase : null;
}

// ---- Board tabs ----------------------------------------------------------
// The BMS board shows the PIPELINE. Leads and construction are their own tabs so
// Ang can organise them separately without cluttering the working board.
// The Pipeline ENDS with the CD stage (Ang): once drawings go out the door the job is
// Permitting/Construction work, which lives in its own tab.
export const BOARD_TABS = [
  { key: 'leads', label: 'Job Leads', phases: ['lead', 'potential', 'job_dropped'] },
  {
    key: 'pipeline',
    label: 'Pipeline',
    phases: ['cd_outgoing', 'cd_prep', 'design_phase', 'survey_zoning', 'on_hold'],
  },
  {
    key: 'construction',
    label: 'In-Construction',
    phases: ['permitting', 'construction', 'completed', 'canceled'],
  },
];

// Grouping/display order within a board, top → bottom. Runs latest-stage first (that's
// how Ang reads the board), with the parked/terminal states last.
export const PHASE_ORDER = [
  'cd_outgoing',
  'cd_prep',
  'design_phase',
  'survey_zoning',
  'potential',
  'lead',
  'construction',
  'permitting',
  'on_hold',
  'completed',
  'job_dropped',
  'canceled',
];

// The working pipeline = live design work. Excludes leads (not won yet), permitting /
// construction (out the door) and the parked/terminal states.
export const PIPELINE_PHASES = ['cd_outgoing', 'cd_prep', 'design_phase', 'survey_zoning'];

// Chronological lifecycle, forward. The three states OUTSIDE it — on_hold (a pause),
// job_dropped (never signed) and canceled (signed, then terminated) — are not stages.
export const PHASE_LADDER = [
  'lead',
  'potential',
  'survey_zoning',
  'design_phase',
  'cd_prep',
  'cd_outgoing',
  'permitting',
  'construction',
  'completed',
];

// Terminal / off-ladder states: no "current" marker, group at the bottom.
export const TERMINAL_PHASES = ['on_hold', 'completed', 'job_dropped', 'canceled'];

// Phases in which a job may still carry the PLACEHOLDER number (`26_xxx_Smith`) — it
// isn't won yet. Moving beyond these means the proposal was signed, so the job earns its
// official sequential number (and its Drive folder). Mirrors UNNUMBERED_PHASES in
// api/_lib/db.js — the server is the source of truth and performs the promotion.
export const UNNUMBERED_PHASES = ['lead', 'potential', 'job_dropped'];

export function phaseLabel(job) {
  if (job.phase_override) return job.phase_override; // manual label wins
  return PHASE_LABELS[job.phase] || job.phase;
}

// ---- Aging ---------------------------------------------------------------
// Ang's two rules: a client shouldn't sit on a proposal for more than 2 weeks, and a
// job shouldn't sit in CDs for more than 3. Surfaced as a flag on the card — never an
// email — so it's visible when you look at the board, not pushed at you.
// NOTE: splitting CD into two phases gives each half its own clock — moving a job from
// Prep to Outgoing restarts the 21 days. That matches "no longer than 3 weeks in this
// phase" as drawn, but it does mean a job can spend 3 weeks in Prep AND 3 in Outgoing
// without ever flagging. Tighten the numbers if that turns out to be too loose.
export const PHASE_AGE_LIMITS = { potential: 14, cd_prep: 21, cd_outgoing: 21 };

// Days a job has been in its current phase, or null when we can't tell.
export function daysInPhase(job, now = Date.now()) {
  const since = job?.phase_since || job?.updated_at;
  if (!since) return null;
  const ms = now - new Date(since).getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

// True when the job has overstayed its phase's limit.
export function isStalled(job, now = Date.now()) {
  const limit = PHASE_AGE_LIMITS[job?.phase];
  if (!limit) return false;
  const days = daysInPhase(job, now);
  return days != null && days > limit;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function money(n, { cents = false } = {}) {
  const v = Number(n || 0);
  return cents ? usdCents.format(v) : usd.format(v);
}

// Addresses are stored as a mailing block ("1 Knapp Ave\nFlorham Park, NJ 07932").
// A single-line <input> drops the newline outright ("…AveFlorham Park"), so flatten
// to a comma-joined line wherever the address renders on one line.
export function addressLine(addr) {
  if (!addr) return '';
  return String(addr)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

export function shortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Pretty-print a byte count the way Drive does (decimal units).
export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return null;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

// Format a date-only string ('YYYY-MM-DD') in local time without a TZ shift.
// (shortDate parses through Date(iso), which reads a bare date as UTC midnight
// and can display the day before in negative-offset zones — use this for the
// phase-date / milestone fields that are stored date-only.)
export function fmtDateOnly(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
