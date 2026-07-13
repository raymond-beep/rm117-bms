// Supabase client module (Phase 1). Server-side only — uses the service-role key,
// which bypasses RLS; every api/ function is responsible for its own scoping.
// Returns null when Supabase env vars are absent (Phase 0 not done yet) so the
// app can fall back to mock data and still boot clean.
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function hasDb() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

export function getDb() {
  if (!hasDb()) return null;
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// Job ID format: YY_NNN_[FF_]LastName — must match the QBO Customer Display Name.
// The name part may contain internal spaces (real Job IDs / QBO customer names do,
// e.g. "26_011_Kuhn_352 Amherst"), but not lead or trail with whitespace.
//
// A LEAD carries a PLACEHOLDER number — `YY_xxx_LastName` (Ang's workflow): the official
// sequential number is only assigned when the proposal is SIGNED, so a lead that never
// converts doesn't burn a job number. `xxx` is therefore a legal id, but a placeholder
// job must never reach QuickBooks or Drive — see isPlaceholderJobId() below.
export const PLACEHOLDER_NUM = 'xxx';
export const JOB_ID_RE = /^\d{2}_(\d{3}|xxx)_(FF_)?\S(.*\S)?$/;

// True for an un-numbered lead (`26_xxx_Smith`). These jobs are deliberately NOT given a
// Drive folder or a QBO customer — both are keyed by the Job ID, and provisioning them
// under a placeholder would just have to be renamed later.
export function isPlaceholderJobId(jobId) {
  return typeof jobId === 'string' && /^\d{2}_xxx_/.test(jobId);
}

// Phases in which a job may still carry a placeholder number: it isn't won yet.
// Moving beyond these means the proposal was signed → the job earns its real number.
export const UNNUMBERED_PHASES = ['lead', 'potential', 'job_dropped'];

// Single phase field, Ang's vocabulary (see SCHEMA.md + PHASE_MODEL.md). Must stay in
// sync with the jobs.phase / field_notes.phase CHECK constraints (migration 0011) and
// the frontend PHASE_* lists in src/lib/format.js.
//   job_dropped = a proposal was rejected; the job never started.
//   canceled    = a SIGNED job terminated early (kept as a record — retainer earned).
//   on_hold     = paused, will resume.
export const PHASES = [
  'lead',
  'potential',
  'survey_zoning',
  'design_phase',
  'cd_prep',
  'cd_outgoing',
  'permitting',
  'construction',
  'on_hold',
  'completed',
  'job_dropped',
  'canceled',
];

// CD is split into two REAL phases (cd_prep / cd_outgoing) — Angelena works the CD stage
// as two distinct piles, so they're board sections she drags between, not a chip on a
// card. Design keeps sub-phases because DPI/II/III vary per job (the proposal sets how
// many), which doesn't map to a fixed set of board sections.
//
// A job's sub_phase must belong to its phase (or be null). Clients never see sub-phases.
export const SUB_PHASES = {
  design_phase: ['dp1', 'dp2', 'dp3'],
};

// Validate a (phase, sub_phase) pair. Null/empty sub_phase is always allowed.
export function isValidSubPhase(phase, subPhase) {
  if (!subPhase) return true;
  return (SUB_PHASES[phase] || []).includes(subPhase);
}

// outstanding is computed, never stored: job_total - sum(payments.amount).
export function computeOutstanding(job, payments) {
  const billedTotal = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return Number(job.job_total || 0) - billedTotal;
}
