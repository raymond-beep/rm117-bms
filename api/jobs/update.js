// POST /api/jobs/update — saveJob(): writes job edits to Supabase (Phase 3).
// Body: { job_id, fields: { ...editable fields } }
import { getDb, hasDb, PHASES } from '../_lib/db.js';

// Whitelist — only fields the JobEditor may write. Everything else is computed,
// import-only, or managed elsewhere.
const EDITABLE = new Set([
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
  'import_needs_review',
  'import_notes',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { job_id, fields } = req.body || {};
  if (!job_id || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'job_id and fields are required' });
  }

  const updates = {};
  for (const [key, value] of Object.entries(fields)) {
    if (EDITABLE.has(key)) updates[key] = value;
  }
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
    const { data, error } = await db
      .from('jobs')
      .update(updates)
      .eq('job_id', job_id)
      .select()
      .single();
    if (error) throw error;
    res.status(200).json({ source: 'supabase', persisted: true, job: data });
  } catch (err) {
    console.error('[api/jobs/update]', err);
    res.status(500).json({ error: err.message });
  }
}
