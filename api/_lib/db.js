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
export const JOB_ID_RE = /^\d{2}_\d{3}_(FF_)?\S(.*\S)?$/;

// Single phase field, Ang's vocabulary (see SCHEMA.md). Must stay in sync with the
// jobs.phase / field_notes.phase CHECK constraints (migration 0008) and the frontend
// PHASE_* lists in src/lib/format.js. 'canceled' = a job terminated early, kept as a record.
export const PHASES = [
  'potential',
  'survey_zoning',
  'design_phase',
  'cd_phase',
  'active',
  'on_hold',
  'completed',
  'canceled',
];

// outstanding is computed, never stored: job_total - sum(payments.amount).
export function computeOutstanding(job, payments) {
  const billedTotal = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return Number(job.job_total || 0) - billedTotal;
}
