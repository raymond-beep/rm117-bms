// Persisted checklist results, keyed by (set, page). Ported from Checksets
// api/results.
//   GET   ?setId=&page=   -> { results, model, sheet_label, sheet_type,
//                              applicable_ids, reviewed_ids, overrides, advisory,
//                              label_issue }
//   PATCH { setId, page, reviewedIds?, overrides? } -> reviewer state layered on
//         top of the AI results (kept separate from `results` so re-analyzing
//         never wipes the reviewer's work).
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';
import { SHEET_TYPES, applicableIdsForType } from '../_lib/checksets/checklist.js';
import { labelMismatch } from '../_lib/checksets/naming.js';

const STATUSES = ['pass', 'fail', 'needs_review'];

export default async function handler(req, res) {
  if (!(await requireStaff(req, res))) return;
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  try {
    if (req.method === 'GET') return getResults(req, res, db);
    if (req.method === 'PATCH') return patchResults(req, res, db);
    return res.status(405).json({ error: 'GET or PATCH only' });
  } catch (err) {
    console.error('[checksets/results]', err);
    return res.status(500).json({ error: err.message });
  }
}

async function getResults(req, res, db) {
  const setId = req.query?.setId;
  const page = Number(req.query?.page);
  if (!setId || !Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: 'setId and page are required' });
  }

  const { data, error } = await db
    .from('checklist_results')
    .select('results, model, created_at, sheet_label, sheet_type, reviewed_ids, overrides, advisory')
    .eq('drawing_set_id', setId)
    .eq('page_number', page)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!data) {
    return res.status(200).json({
      results: null, model: null, created_at: null, sheet_label: null, sheet_type: null,
      applicable_ids: null, reviewed_ids: [], overrides: {}, advisory: null, label_issue: null,
    });
  }

  const type = SHEET_TYPES.includes(data.sheet_type) ? data.sheet_type : null;
  const applicable_ids = type ? applicableIdsForType(type) : null;
  const label_issue = labelMismatch(data.sheet_label, type);
  return res.status(200).json({ ...data, applicable_ids, label_issue });
}

async function patchResults(req, res, db) {
  const body = req.body || {};
  const setId = body.setId;
  const page = Number(body.page);
  if (!setId || !Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: 'setId and page are required' });
  }

  const patch = {};
  if (body.reviewedIds !== undefined) {
    if (!Array.isArray(body.reviewedIds) || !body.reviewedIds.every((x) => typeof x === 'string')) {
      return res.status(400).json({ error: 'reviewedIds must be an array of strings' });
    }
    patch.reviewed_ids = [...new Set(body.reviewedIds)];
  }
  if (body.overrides !== undefined) {
    const o = body.overrides;
    if (typeof o !== 'object' || o === null || Array.isArray(o)) {
      return res.status(400).json({ error: 'overrides must be an object' });
    }
    const clean = {};
    for (const [id, status] of Object.entries(o)) {
      if (typeof status !== 'string' || !STATUSES.includes(status)) {
        return res.status(400).json({ error: `invalid override status for ${id}` });
      }
      clean[id] = status;
    }
    patch.overrides = clean;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  const { error, count } = await db
    .from('checklist_results')
    .update(patch, { count: 'exact' })
    .eq('drawing_set_id', setId)
    .eq('page_number', page);
  if (error) throw new Error(error.message);
  if (!count) return res.status(404).json({ error: 'No analysis exists for this sheet yet' });
  return res.status(200).json({ ok: true, ...patch });
}
