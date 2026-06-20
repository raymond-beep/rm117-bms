// /api/field-notes — on-site field notes for a job (internal, staff-only).
//   GET  ?job_id=...              -> a job's notes, newest first
//   POST { job_id, body }         -> add a note (author = the signed-in staff user)
//
// Staff-only: both methods require a valid Clerk session token (Bearer). The
// author_id is taken from the verified token, never trusted from the body.
// attachments/location are reserved for phase 2 (photo/voice/geo capture).
import { getDb, hasDb, JOB_ID_RE } from './_lib/db.js';
import { hasClerk, getUserId } from './_lib/clerk.js';

export default async function handler(req, res) {
  // Per-user live data — never serve a stale cached copy.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'GET') return getNotes(req, res);
  if (req.method === 'POST') return createNote(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// Resolve the staff user from the Clerk token. Returns the user id, or sends a
// 401 and returns null. When Clerk isn't configured (pure local mock), we allow
// an anonymous "local" author so the feature still works offline.
async function requireStaff(req, res) {
  if (!hasClerk()) return 'local-dev';
  const userId = await getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return userId;
}

async function getNotes(req, res) {
  const jobId = req.query.job_id;
  if (!jobId) return res.status(400).json({ error: 'job_id is required' });

  const userId = await requireStaff(req, res);
  if (!userId) return; // 401 already sent

  try {
    if (!hasDb()) return res.status(200).json({ source: 'mock', notes: [] });
    const db = getDb();
    const { data, error } = await db
      .from('field_notes')
      .select('id, job_id, body, author_id, attachments, location, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.status(200).json({ source: 'supabase', notes: data || [] });
  } catch (err) {
    console.error('[api/field-notes GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function createNote(req, res) {
  const { job_id, body } = req.body || {};
  if (!job_id || !JOB_ID_RE.test(job_id)) {
    return res.status(400).json({ error: 'A valid job_id is required' });
  }
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return res.status(400).json({ error: 'body is required' });

  const userId = await requireStaff(req, res);
  if (!userId) return; // 401 already sent

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    const { data, error } = await db
      .from('field_notes')
      .insert({ job_id, body: text, author_id: userId })
      .select('id, job_id, body, author_id, attachments, location, created_at')
      .single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, note: data });
  } catch (err) {
    console.error('[api/field-notes POST]', err);
    res.status(500).json({ error: err.message });
  }
}
