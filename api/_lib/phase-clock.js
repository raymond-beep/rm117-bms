// Starting (and keeping) the per-job phase clock.
//
// `job_phase_events` is an append-only log of when a job ENTERED each phase. Two things
// read it: the Progress-tab timeline, and — the reason this helper exists — the answer to
// "how long is each phase actually taking us?", which is only as good as the stamping.
//
// ⚠️ THE CLOCK USED TO START LATE. Only `api/jobs/update.js` stamped, and only on a phase
// CHANGE, so a job had no event until the first time somebody moved it. Measured
// 2026-07-25: 29 of 162 jobs had no event at all (every one of them Drive-imported) and
// 13 had no `phase_since`. A job's FIRST phase was therefore unmeasurable — exactly the
// phases (Lead, Proposal Sent) where the firm most wants to know how long things sit.
// Creation now stamps too, so duration data accrues from the moment a job exists.
//
// Historical note: this cannot be backfilled. The events that were never written are
// simply not recoverable, so per-phase averages start accruing from 2026-07-25 forward.

// Record that `job_id` entered `phase` now. Best-effort by design: the timeline is a side
// record, and failing a job create/save because the log hiccuped would be a worse bug
// than a missing row. Callers do not await a result they act on.
export async function stampPhaseEntry(db, job_id, phase, { where = 'phase-clock' } = {}) {
  if (!db || !job_id || !phase) return false;
  const { error } = await db.from('job_phase_events').insert({ job_id, phase });
  if (error) {
    console.error(`[${where}] phase-event insert`, error);
    return false;
  }
  return true;
}
