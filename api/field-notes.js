// /api/field-notes — on-site field notes for a job (internal, staff-only).
//   GET  ?job_id=...              -> a job's notes, newest first
//   POST { job_id, body }         -> add a note (author = the signed-in staff user)
//
// Staff-only: both methods require a valid Clerk session token (Bearer). The
// author_id is taken from the verified token, never trusted from the body.
// attachments/location are reserved for phase 2 (photo/voice/geo capture).
import { getDb, hasDb, JOB_ID_RE } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const BUCKET = 'field-notes';
const SIGNED_URL_TTL = 3600; // 1h — long enough for a session, short enough to stay private

export default async function handler(req, res) {
  // Per-user live data — never serve a stale cached copy.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'GET') return getNotes(req, res);
  if (req.method === 'POST') return createNote(req, res);
  if (req.method === 'PATCH') return updateNote(req, res);
  if (req.method === 'DELETE') return deleteNote(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
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
    const notes = await signAttachments(db, data || []);
    res.status(200).json({ source: 'supabase', notes });
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
  const attachments = sanitizeAttachments(req.body?.attachments);
  const location = sanitizeLocation(req.body?.location);
  // A note must carry *something* — text, an attachment, or a pinned location.
  if (!text && attachments.length === 0 && !location) {
    return res.status(400).json({ error: 'A note needs text, an attachment, or a location' });
  }

  const userId = await requireStaff(req, res);
  if (!userId) return; // 401 already sent

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    const { data, error } = await db
      .from('field_notes')
      .insert({ job_id, body: text, author_id: userId, attachments, location })
      .select('id, job_id, body, author_id, attachments, location, created_at')
      .single();
    if (error) throw error;
    const [note] = await signAttachments(db, [data]);
    res.status(201).json({ source: 'supabase', persisted: true, note });
  } catch (err) {
    console.error('[api/field-notes POST]', err);
    res.status(500).json({ error: err.message });
  }
}

// PATCH { id, body } — edit a note's text. Staff-only. Attachments/location are
// not edited here (delete the note to remove media).
async function updateNote(req, res) {
  const { id, body } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const text = typeof body === 'string' ? body.trim() : '';

  const userId = await requireStaff(req, res);
  if (!userId) return; // 401 already sent

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    const { data, error } = await db
      .from('field_notes')
      .update({ body: text })
      .eq('id', id)
      .select('id, job_id, body, author_id, attachments, location, created_at')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Note not found' });
    const [note] = await signAttachments(db, [data]);
    res.status(200).json({ source: 'supabase', persisted: true, note });
  } catch (err) {
    console.error('[api/field-notes PATCH]', err);
    res.status(500).json({ error: err.message });
  }
}

// DELETE { id } — remove a note and any attachment files from Storage. Staff-only.
async function deleteNote(req, res) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const userId = await requireStaff(req, res);
  if (!userId) return; // 401 already sent

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    // Pull the row first so we can clean up its stored files.
    const { data: existing, error: selErr } = await db
      .from('field_notes')
      .select('id, attachments')
      .eq('id', id)
      .single();
    if (selErr && selErr.code !== 'PGRST116') throw selErr; // PGRST116 = no rows
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    const paths = (existing.attachments || []).map((a) => a?.path).filter(Boolean);
    if (paths.length) {
      const { error: rmErr } = await db.storage.from(BUCKET).remove(paths);
      if (rmErr) console.error('[api/field-notes DELETE storage]', rmErr); // non-fatal
    }

    const { error } = await db.from('field_notes').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', persisted: true, id });
  } catch (err) {
    console.error('[api/field-notes DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}

// Keep only well-formed attachment refs: { type:'photo'|'voice', path, name }.
function sanitizeAttachments(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a) => a && (a.type === 'photo' || a.type === 'voice') && typeof a.path === 'string' && a.path)
    .slice(0, 10)
    .map((a) => ({ type: a.type, path: a.path, name: typeof a.name === 'string' ? a.name : null }));
}

// Accept a finite {lat, lng} pair only; anything else → null (no location).
function sanitizeLocation(input) {
  if (!input || typeof input !== 'object') return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// Replace each stored attachment `path` with a short-lived signed download `url`
// so the private bucket is never exposed directly. One batched call per request.
async function signAttachments(db, notes) {
  const paths = [];
  for (const n of notes) for (const a of n.attachments || []) if (a?.path) paths.push(a.path);
  if (paths.length === 0) return notes;

  let signedByPath = {};
  try {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    for (const row of data || []) if (row.path && row.signedUrl) signedByPath[row.path] = row.signedUrl;
  } catch (err) {
    console.error('[api/field-notes signAttachments]', err);
  }
  return notes.map((n) => ({
    ...n,
    attachments: (n.attachments || []).map((a) => ({ ...a, url: signedByPath[a.path] || null })),
  }));
}
