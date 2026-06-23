// POST /api/jobs/update — saveJob(): writes job edits to Supabase (Phase 3).
// Body: { job_id, fields: { ...editable fields } }
import { getDb, hasDb, PHASES } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';

// Whitelist — only fields the JobEditor may write. Everything else is computed,
// import-only, or managed elsewhere.
const EDITABLE = new Set([
  'client_id',
  'client_name',
  'address',
  'phase',
  'phase_override',
  'job_total',
  'amount_billed',
  'bill_flag',
  'is_forefront',
  'ff_commission',
  'ff_commission_paid',
  'notes',
  'last_correspondence',
  'next_milestone_label',
  'next_milestone_date',
  'import_needs_review',
  'import_notes',
  'board_position', // manual within-phase ordering (BMS grouped view)
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const { job_id, fields } = req.body || {};
  if (!job_id || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'job_id and fields are required' });
  }

  const updates = {};
  for (const [key, value] of Object.entries(fields)) {
    if (EDITABLE.has(key)) updates[key] = value;
  }
  // client_id is a uuid FK — an empty string from the picker means "unlink".
  if (updates.client_id === '') updates.client_id = null;
  // next_milestone_date is a date column — empty string means "clear it".
  if (updates.next_milestone_date === '') updates.next_milestone_date = null;
  if (updates.next_milestone_label === '') updates.next_milestone_label = null;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields in request' });
  }
  if (updates.phase && !PHASES.includes(updates.phase)) {
    return res.status(400).json({ error: `Invalid phase: ${updates.phase}` });
  }
  updates.updated_at = new Date().toISOString();

  if (!hasDb()) {
    // Pre-Phase-1 dev: accept the write so the optimistic UI flow can be exercised,
    // but be explicit that nothing persisted.
    return res.status(200).json({ source: 'mock', persisted: false, job_id, updates });
  }

  try {
    const db = getDb();

    // If the phase is changing, read the stored value first so we can stamp a
    // phase-reached event (the progress timeline) only on a real transition.
    let priorPhase = null;
    if (updates.phase) {
      const { data: cur } = await db
        .from('jobs')
        .select('phase')
        .eq('job_id', job_id)
        .single();
      priorPhase = cur?.phase ?? null;
    }

    const { data, error } = await db
      .from('jobs')
      .update(updates)
      .eq('job_id', job_id)
      .select()
      .single();
    if (error) throw error;

    if (updates.phase && updates.phase !== priorPhase) {
      const { error: evErr } = await db
        .from('job_phase_events')
        .insert({ job_id, phase: updates.phase });
      // Don't fail the save if the timeline log hiccups — it's a side record.
      if (evErr) console.error('[api/jobs/update] phase-event insert', evErr);
    }

    res.status(200).json({ source: 'supabase', persisted: true, job: data });
  } catch (err) {
    console.error('[api/jobs/update]', err);
    res.status(500).json({ error: err.message });
  }
}
