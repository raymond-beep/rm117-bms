// Set Check runs — one per (job, item type, submitted document).
//   POST  { jobId, itemType? }                    -> find-or-create the open run -> { run }
//   GET   ?id=                                    -> { run }
//   GET   ?jobId=                                 -> { runs } (that job's history, newest first)
//   PATCH ?id= { scheduleFileId?, rescheckFileId?, submittalFileId?, status? } -> { run }
// Staff-gated. Mirrors api/checksets/sets.js — a run row records WHICH Drive files to
// compare; the PDF bytes are streamed on demand via /api/set-check/files, never stored.
import { requireStaff } from '../_lib/require-staff.js';
import { getDb, JOB_ID_RE } from '../_lib/db.js';

const ITEM_TYPES = ['window', 'ext_door', 'fire_door', 'fixture'];
const STATUSES = ['open', 'analyzed', 'confirmed'];

export default async function handler(req, res) {
  const userId = await requireStaff(req, res);
  if (!userId) return; // 401/403 already sent
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  try {
    if (req.method === 'POST') return openRun(req, res, db, userId);
    if (req.method === 'GET') return getRuns(req, res, db);
    if (req.method === 'PATCH') return patchRun(req, res, db);
    return res.status(405).json({ error: 'POST, GET or PATCH only' });
  } catch (err) {
    console.error('[set-check/runs]', err);
    return res.status(500).json({ error: err.message });
  }
}

// Find-or-create the run a staffer is working on for this (job, item type).
//
// "Find" is deliberately scoped to a run that is still OPEN: picking documents and
// analyzing is one sitting, so returning to the tab should resume it rather than
// start a blank third run. Once a run is confirmed it is a RECORD of what was
// checked — reopening the job then starts a fresh one instead of mutating history.
async function openRun(req, res, db, userId) {
  const body = req.body || {};
  const jobId = String(body.jobId ?? '').trim();
  const itemType = String(body.itemType ?? 'window').trim();
  if (!JOB_ID_RE.test(jobId)) return res.status(400).json({ error: 'Invalid jobId' });
  if (!ITEM_TYPES.includes(itemType)) return res.status(400).json({ error: 'Invalid itemType' });

  const existing = await db
    .from('set_check_runs')
    .select('*')
    .eq('job_number', jobId)
    .eq('item_type', itemType)
    .neq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return res.status(200).json({ run: existing.data });

  const { data: run, error } = await db
    .from('set_check_runs')
    .insert({ job_number: jobId, item_type: itemType, created_by: userId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return res.status(200).json({ run });
}

async function getRuns(req, res, db) {
  const id = req.query?.id;
  const jobId = req.query?.jobId;

  if (id) {
    const { data: run, error } = await db.from('set_check_runs').select('*').eq('id', id).single();
    if (error || !run) return res.status(404).json({ error: 'Run not found' });
    return res.status(200).json({ run });
  }

  if (!jobId) return res.status(400).json({ error: 'id or jobId is required' });
  const { data, error } = await db
    .from('set_check_runs')
    .select('*')
    .eq('job_number', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return res.status(200).json({ runs: data || [] });
}

// Set (or clear) the three document choices, or move the run's status along.
// Clearing matters: a staffer who picked the wrong brochure needs to un-pick it,
// so an explicit null is a valid value here — only `undefined` means "leave alone".
async function patchRun(req, res, db) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'id is required' });
  const body = req.body || {};
  const patch = {};

  const fileFields = {
    scheduleFileId: 'schedule_file_id',
    rescheckFileId: 'rescheck_file_id',
    submittalFileId: 'submittal_file_id',
  };
  for (const [key, column] of Object.entries(fileFields)) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') patch[column] = null;
    else if (typeof body[key] === 'string') patch[column] = body[key].trim();
    else return res.status(400).json({ error: `Invalid ${key}` });
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db.from('set_check_runs').update(patch).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return res.status(200).json({ run: data });
}
