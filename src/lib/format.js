// Shared display helpers — phase vocabulary and money formatting.

export const PHASE_LABELS = {
  potential: 'Potential',
  survey_zoning: 'Survey/Zoning',
  design_phase: 'Design Phase',
  cd_phase: 'CD Phase',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
};

export const PHASE_ORDER = [
  'potential',
  'survey_zoning',
  'design_phase',
  'cd_phase',
  'active',
  'on_hold',
  'completed',
];

// Pipeline = everything not completed and not on hold.
export const PIPELINE_PHASES = ['potential', 'survey_zoning', 'design_phase', 'cd_phase', 'active'];

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
