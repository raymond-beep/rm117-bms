// /api/letters — saved building-department letters (internal, staff-only).
//   GET             -> list (newest-edited first; id, job_id, title, dates)
//   GET ?id=...     -> one letter with its full `content` (to reopen)
//   POST { id?, job_id?, content }  -> create (no id) or update (id)
//   DELETE { id }   -> remove a saved letter
//
// Fields-only: `content` jsonb holds the form state (no files; the PDF and any
// attachments are not persisted). All methods require a valid Clerk staff token.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const COLS = 'id, job_id, content, created_at, updated_at';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return save(req, res);
  if (req.method === 'DELETE') return remove(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function list(req, res) {
  if (!(await requireStaff(req, res))) return;
  const id = req.query.id;
  try {
    if (!hasDb()) return res.status(200).json({ source: 'mock', letters: id ? null : [] });
    const db = getDb();
    if (id) {
      const { data, error } = await db.from('letters').select(COLS).eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return res.status(404).json({ error: 'Letter not found' });
      return res.status(200).json({ source: 'supabase', letter: data });
    }
    const { data, error } = await db.from('letters').select(COLS).order('updated_at', { ascending: false });
    if (error) throw error;
    const letters = (data || []).map((l) => ({
      id: l.id, job_id: l.job_id,
      title: l.content?.projectAddress || l.content?.deptName || '(untitled letter)',
      created_at: l.created_at, updated_at: l.updated_at,
    }));
    res.status(200).json({ source: 'supabase', letters });
  } catch (err) {
    console.error('[api/letters GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function save(req, res) {
  if (!(await requireStaff(req, res))) return;
  const { id, job_id, content } = req.body || {};
  if (!content || typeof content !== 'object') {
    return res.status(400).json({ error: 'content (object) is required' });
  }
  const row = { job_id: job_id || null, content, updated_at: new Date().toISOString() };

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    if (id) {
      const { data, error } = await db.from('letters').update(row).eq('id', id).select(COLS).single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Letter not found' });
      return res.status(200).json({ source: 'supabase', persisted: true, letter: data });
    }
    const { data, error } = await db.from('letters').insert(row).select(COLS).single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, letter: data });
  } catch (err) {
    console.error('[api/letters POST]', err);
    res.status(500).json({ error: err.message });
  }
}

async function remove(req, res) {
  if (!(await requireStaff(req, res))) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    const { error } = await db.from('letters').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', persisted: true, id });
  } catch (err) {
    console.error('[api/letters DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}
