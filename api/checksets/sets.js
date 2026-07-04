// Drawing sets for the Drawing QA tab. Unlike the standalone Checksets app
// (which uploaded a PDF to Supabase Storage), a set here is sourced from a job's
// Google Drive "Checksets" folder — so a set row just records which Drive file
// it points at; the PDF bytes are streamed on demand via /api/jobs/checkset-files.
//   POST { jobId, driveFileId, filename, folderId? } -> find-or-create -> { set }
//   GET  ?id=                                        -> { set }
//   PATCH ?id= { pageCount?, status? }               -> { set }
import { requireStaff } from '../_lib/require-staff.js';
import { getDb, JOB_ID_RE } from '../_lib/db.js';

const STATUSES = ['uploaded', 'in_review', 'reviewed'];

export default async function handler(req, res) {
  const userId = await requireStaff(req, res);
  if (!userId) return; // 401/403 already sent
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  try {
    if (req.method === 'POST') return openSet(req, res, db, userId);
    if (req.method === 'GET') return getSet(req, res, db);
    if (req.method === 'PATCH') return patchSet(req, res, db);
    return res.status(405).json({ error: 'POST, GET or PATCH only' });
  } catch (err) {
    console.error('[checksets/sets]', err);
    return res.status(500).json({ error: err.message });
  }
}

// Find-or-create the set row for a (job, Drive file) pair so re-opening the same
// checkset returns the same set (and its saved analysis/markup).
async function openSet(req, res, db, userId) {
  const body = req.body || {};
  const jobId = String(body.jobId ?? '').trim();
  const driveFileId = String(body.driveFileId ?? '').trim();
  const filename = String(body.filename ?? '').trim();
  if (!JOB_ID_RE.test(jobId)) return res.status(400).json({ error: 'Invalid jobId' });
  if (!driveFileId) return res.status(400).json({ error: 'driveFileId is required' });

  const existing = await db
    .from('drawing_sets')
    .select('*')
    .eq('job_number', jobId)
    .eq('drive_file_id', driveFileId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return res.status(200).json({ set: existing.data });

  const { data: set, error } = await db
    .from('drawing_sets')
    .insert({
      job_number: jobId,
      drive_file_id: driveFileId,
      drive_folder_id: body.folderId ? String(body.folderId) : null,
      original_filename: filename || 'drawing-set.pdf',
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return res.status(200).json({ set });
}

async function getSet(req, res, db) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'id is required' });
  const { data: set, error } = await db.from('drawing_sets').select('*').eq('id', id).single();
  if (error || !set) return res.status(404).json({ error: 'Set not found' });
  return res.status(200).json({ set });
}

async function patchSet(req, res, db) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'id is required' });
  const body = req.body || {};
  const patch = {};
  if (Number.isInteger(body.pageCount) && body.pageCount > 0) patch.page_count = body.pageCount;
  if (typeof body.status === 'string' && STATUSES.includes(body.status)) patch.status = body.status;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const { data, error } = await db.from('drawing_sets').update(patch).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return res.status(200).json({ set: data });
}
