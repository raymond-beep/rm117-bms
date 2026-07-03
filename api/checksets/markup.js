// Reviewer markup, keyed by (set, page). Shapes are stored verbatim in
// NORMALIZED page coordinates. Ported from Checksets api/markup.
//   GET  ?setId=&page=            -> { shapes: MarkupPayload | null }
//   PUT  { setId, page, shapes }  -> { ok: true }
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!(await requireStaff(req, res))) return; // 401/403 already sent
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });

  try {
    if (req.method === 'GET') {
      const setId = req.query?.setId;
      const page = Number(req.query?.page);
      if (!setId || !Number.isInteger(page) || page < 1) {
        return res.status(400).json({ error: 'setId and page are required' });
      }
      const { data, error } = await db
        .from('markup')
        .select('shapes')
        .eq('drawing_set_id', setId)
        .eq('page_number', page)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return res.status(200).json({ shapes: data?.shapes ?? null });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const setId = String(body.setId ?? '');
      const page = Number(body.page);
      const shapes = body.shapes;
      if (!setId || !Number.isInteger(page) || page < 1) {
        return res.status(400).json({ error: 'setId and page are required' });
      }
      if (!shapes || shapes.v !== 1 || !Array.isArray(shapes.shapes)) {
        return res.status(400).json({ error: 'shapes must be a v1 MarkupPayload' });
      }
      const { error } = await db.from('markup').upsert(
        { drawing_set_id: setId, page_number: page, shapes, updated_at: new Date().toISOString() },
        { onConflict: 'drawing_set_id,page_number' },
      );
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'GET or PUT only' });
  } catch (err) {
    console.error('[checksets/markup]', err);
    return res.status(500).json({ error: err.message });
  }
}
