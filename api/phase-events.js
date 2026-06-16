// GET /api/phase-events?job_id=... — a job's phase-reached timeline (internal).
// Append-only log; ordered oldest→newest so the UI can render the ladder in order.
import { getDb, hasDb } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const jobId = req.query.job_id;
  if (!jobId) return res.status(400).json({ error: 'job_id is required' });

  try {
    if (!hasDb()) return res.status(200).json({ source: 'mock', events: [] });
    const db = getDb();
    const { data, error } = await db
      .from('job_phase_events')
      .select('id, phase, entered_at, note')
      .eq('job_id', jobId)
      .order('entered_at', { ascending: true });
    if (error) throw error;
    res.status(200).json({ source: 'supabase', events: data || [] });
  } catch (err) {
    console.error('[api/phase-events]', err);
    res.status(500).json({ error: err.message });
  }
}
