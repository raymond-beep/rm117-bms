// /api/phase-events — a job's phase-reached timeline (internal, staff-only).
//   GET  ?job_id=...                       -> events, oldest→newest
//   POST { job_id, phase, date }           -> set the date that phase was reached
//                                             (updates the earliest event for that
//                                              phase, or inserts one if none)
//   DELETE { job_id, phase }               -> clear the date for that phase
import { getDb, hasDb, PHASES } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return getEvents(req, res);
  if (req.method === 'POST') return setEvent(req, res);
  if (req.method === 'DELETE') return clearEvent(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getEvents(req, res) {
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
    console.error('[api/phase-events GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function setEvent(req, res) {
  const { job_id, phase, date } = req.body || {};
  if (!job_id || !phase) return res.status(400).json({ error: 'job_id and phase are required' });
  if (!PHASES.includes(phase)) return res.status(400).json({ error: `Invalid phase: ${phase}` });
  if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  // Store at noon UTC so day-granularity display never shifts across a timezone.
  const enteredAt = `${date}T12:00:00Z`;

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    // Update the earliest existing event for this phase (the "reached" one), else insert.
    const { data: existing, error: selErr } = await db
      .from('job_phase_events')
      .select('id')
      .eq('job_id', job_id)
      .eq('phase', phase)
      .order('entered_at', { ascending: true })
      .limit(1);
    if (selErr) throw selErr;

    if (existing && existing.length) {
      const { data, error } = await db
        .from('job_phase_events')
        .update({ entered_at: enteredAt, note: 'date set by staff' })
        .eq('id', existing[0].id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ source: 'supabase', persisted: true, event: data });
    }
    const { data, error } = await db
      .from('job_phase_events')
      .insert({ job_id, phase, entered_at: enteredAt, note: 'date set by staff' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, event: data });
  } catch (err) {
    console.error('[api/phase-events POST]', err);
    res.status(500).json({ error: err.message });
  }
}

async function clearEvent(req, res) {
  const { job_id, phase } = req.body || {};
  if (!job_id || !phase) return res.status(400).json({ error: 'job_id and phase are required' });
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    const { error } = await db
      .from('job_phase_events')
      .delete()
      .eq('job_id', job_id)
      .eq('phase', phase);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', persisted: true });
  } catch (err) {
    console.error('[api/phase-events DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}
