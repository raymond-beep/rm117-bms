// Shared display helpers — phase vocabulary and money formatting.

export const PHASE_LABELS = {
  potential: 'Proposal Sent',
  survey_zoning: 'Survey + Zoning Analysis + Schematics',
  design_phase: 'Design Phase',
  cd_phase: 'CD Phase',
  active: 'Outgoing',
  on_hold: 'On Hold',
  completed: 'Completed',
};

// Grouping/display order, top → bottom (Ang's BMS sections):
// Outgoing, CD Phase, Design Phase, Survey + Zoning + Schematics, Potential,
// then On Hold and Completed. The internal phase keys are unchanged — only the
// display order and labels above. (The chronological lifecycle order — used by
// the Progress ladder — runs the other way: Potential → … → Outgoing → Completed.)
export const PHASE_ORDER = [
  'active',
  'cd_phase',
  'design_phase',
  'survey_zoning',
  'potential',
  'on_hold',
  'completed',
];

// Pipeline = everything not completed and not on hold.
export const PIPELINE_PHASES = ['active', 'cd_phase', 'design_phase', 'survey_zoning', 'potential'];

// Chronological lifecycle a job moves through (the Progress ladder / portal
// timeline) — runs forward, opposite the grouping order above. On-hold sits
// outside the ladder (it's a pause, not a stage).
export const PHASE_LADDER = ['potential', 'survey_zoning', 'design_phase', 'cd_phase', 'active', 'completed'];

export function phaseLabel(job) {
  if (job.phase_override) return job.phase_override; // manual label wins
  return PHASE_LABELS[job.phase] || job.phase;
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

export function shortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
