// The client-facing phase ladder, server side — and the "Next up" derivation built on it.
//
// WHY THIS EXISTS: `jobs.next_milestone_label` is a manual field, and in 162 jobs it was
// never once filled in (checked 2026-07-25). A forward-looking line the client actually
// reads cannot depend on someone remembering to type it, so the portal now DERIVES it
// from where the job sits on the ladder and treats the typed field as an override.
//
// ⚠️ This ladder is the CLIENT vocabulary, not the staff phase set. Sub-phases are
// deliberately absent and `cd_prep`/`cd_outgoing` collapse into ONE "Construction
// Drawings" step — a client who is told their drawings are "90% done" replies "so
// where's my set?". Deriving from this ladder (rather than from PHASES) is what keeps
// the internal CD split from leaking out through the back door of a Next-up line.
//
// ⭐ MIRRORS `CLIENT_LADDER` in `src/lib/portal-ladder.js` (the portal renders the
// stepper from that copy). `tests/portal-ladder.test.js` asserts the two are identical —
// if you edit one, edit both or that test goes red.
export const CLIENT_LADDER = [
  { key: 'potential', label: 'Proposal', phases: ['potential'] },
  { key: 'survey_zoning', label: 'Survey / Zoning', phases: ['survey_zoning'] },
  { key: 'design_phase', label: 'Design', phases: ['design_phase'] },
  { key: 'cd', label: 'Construction Drawings', phases: ['cd_prep', 'cd_outgoing'] },
  { key: 'permitting', label: 'Permitting', phases: ['permitting'] },
  { key: 'construction', label: 'Construction', phases: ['construction'] },
  { key: 'completed', label: 'Complete', phases: ['completed'] },
];

// Phases with no meaningful "next" to show a client.
//
// `on_hold` is here by Ray's call (2026-07-25): a paused job already shows an "On hold"
// chip, and naming the phase it would resume into reads as queued-up progress that isn't
// happening. `lead` never reaches the portal at all. The terminal states have no next by
// definition — and `canceled`/`job_dropped` must never advertise a future step.
const NO_NEXT_PHASES = ['lead', 'on_hold', 'completed', 'canceled', 'job_dropped'];

// The ladder step AFTER the one this job currently sits in. Null when there isn't one.
export function nextLadderStep(phase) {
  if (!phase || NO_NEXT_PHASES.includes(phase)) return null;
  const i = CLIENT_LADDER.findIndex((s) => s.phases.includes(phase));
  if (i === -1) return null;
  return CLIENT_LADDER[i + 1] || null; // last rung (Complete) has no next
}

// What the client sees on the "Next up" line.
//
// Precedence: a label staff TYPED always wins — it is more specific than a phase name
// ("Township review meeting" beats "Permitting"), and taking it away would be a
// regression for whoever finally starts using the field. Derivation only fills the gap.
//
// The derived form carries NO DATE, on purpose. The date the firm assigns per phase is
// an internal planning figure; publishing it to a client turns an estimate into a
// commitment they will hold the firm to. Only a staff-typed milestone may carry a date.
export function deriveNextUp(job) {
  const typed = (job?.next_milestone_label || '').trim();
  if (typed) {
    return { label: typed, date: job?.next_milestone_date || null, derived: false };
  }
  const step = nextLadderStep(job?.phase);
  if (!step) return { label: null, date: null, derived: false };
  return { label: step.label, date: null, derived: true };
}
