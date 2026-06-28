// /api/proposals — saved proposals for the generator (internal, staff-only).
//   GET                 -> list (newest-edited first; id, job_id, title, status, dates)
//   GET ?id=...         -> one proposal with its full `content` (to reopen)
//   POST { id?, job_id?, status?, content }
//                       -> create (no id) or update (id); returns the row
//   DELETE { id }       -> remove a saved proposal
//
// Fields-only: `content` jsonb holds the form state (no files; the PDF and any
// attachments are not persisted). All methods require a valid Clerk staff token.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const STATUSES = ['draft', 'sent', 'signed'];
const COLS = 'id, job_id, status, content, docusign_envelope_id, sent_date, signed_date, created_at, updated_at';

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
    if (!hasDb()) return res.status(200).json({ source: 'mock', proposals: id ? null : [] });
    const db = getDb();
    if (id) {
      const { data, error } = await db.from('proposals').select(COLS).eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return res.status(404).json({ error: 'Proposal not found' });
      return res.status(200).json({ source: 'supabase', proposal: data });
    }
    const { data, error } = await db
      .from('proposals')
      .select('id, job_id, status, content, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    // Surface a display title from content without shipping the whole blob twice.
    const proposals = (data || []).map((p) => ({
      id: p.id, job_id: p.job_id, status: p.status,
      title: p.content?.title || p.content?.projectAddress || '(untitled proposal)',
      created_at: p.created_at, updated_at: p.updated_at,
    }));
    res.status(200).json({ source: 'supabase', proposals });
  } catch (err) {
    console.error('[api/proposals GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function save(req, res) {
  if (!(await requireStaff(req, res))) return;
  const { id, job_id, status, content } = req.body || {};
  if (!content || typeof content !== 'object') {
    return res.status(400).json({ error: 'content (object) is required' });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }
  const row = {
    job_id: job_id || null,
    content,
    ...(status ? { status } : {}),
    updated_at: new Date().toISOString(),
  };

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    if (id) {
      const { data, error } = await db.from('proposals').update(row).eq('id', id).select(COLS).single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Proposal not found' });
      return res.status(200).json({ source: 'supabase', persisted: true, proposal: data });
    }
    const { data, error } = await db.from('proposals').insert(row).select(COLS).single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, proposal: data });
  } catch (err) {
    console.error('[api/proposals POST]', err);
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
    const { error } = await db.from('proposals').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', persisted: true, id });
  } catch (err) {
    console.error('[api/proposals DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}
