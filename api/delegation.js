// /api/delegation — the weekly Delegation Board (internal, staff-only).
// Replaces Angelena's hand-drawn paper delegation sheet: a Mon–Fri × employee
// grid of Apple-Pencil ink, one board per week (keyed by the Monday date).
//
//   GET  ?week=YYYY-MM-DD                    -> { members, strokes, notes, me }
//   POST { week, row_owner_email, points,    -> insert one finished ink stroke
//          color }
//   POST { week, row_owner_email, day_index, -> upsert a typed note in a day cell
//          text }                               (blank text deletes the cell's note)
//   DELETE { id }                            -> remove one stroke (undo)
//   DELETE { week, row_owner_email,          -> clear every stroke in a row
//            clearRow:true }
//
// PERMISSIONS (enforced here, server-side — NOT in the browser and NOT via RLS,
// because this app reaches Supabase only through the service-role key). A signed-in
// staff member may draw/clear only their OWN row; the admin (Angelena) may draw in
// ANY row. Reads are open to all staff — full visibility is the whole point.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';
import { getUserEmail } from './_lib/clerk.js';

// --- Pure permission helpers (unit-tested in tests/delegation-perms.test.js) ---

// The shared "Everyone" lane at the top of the board — a firm-wide row (e.g. a
// measure-up that applies to the whole studio) that admins fill once instead of
// writing into all five people's boxes. It's a reserved row_owner_email (NOT a
// valid email, so it can never collide with a real Clerk login) and is admin-write
// only. Keep this value in sync with STUDIO_ROW in Delegation.jsx.
export const STUDIO_ROW = '__studio__';

// Can `actor` draw into / clear the row owned by `rowOwnerEmail`?
export function canWrite(actor, rowOwnerEmail) {
  if (!actor) return false;
  if (actor.is_admin) return true;
  if (rowOwnerEmail === STUDIO_ROW) return false; // shared lane is admin-only
  return Boolean(actor.email) && actor.email === rowOwnerEmail;
}

// Can `actor` delete this specific stroke? Own strokes (undo) or admin.
export function canDelete(actor, stroke) {
  if (!actor || !stroke) return false;
  if (actor.is_admin) return true;
  return Boolean(actor.email) && actor.email === stroke.created_by_email;
}

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_POINTS = 5000; // a single pen stroke; guards against oversized payloads
const MAX_NOTE = 2000;   // a typed cell note; generous but bounded

// Resolve the acting staff member into { email, is_admin }. Returns null after
// sending the 401/403 (requireStaff handles that). In pure-local dev (no Clerk)
// requireStaff returns 'local-dev' — treat that as an admin actor so the board is
// usable offline.
async function resolveActor(req, res) {
  const userId = await requireStaff(req, res);
  if (!userId) return null; // 401/403 already sent
  if (userId === 'local-dev') return { email: 'local-dev@rm117.com', is_admin: true };

  const email = await getUserEmail(userId);
  if (!hasDb()) return { email, is_admin: false };
  const db = getDb();
  const { data } = await db
    .from('delegation_members')
    .select('is_admin')
    .eq('clerk_email', email)
    .maybeSingle();
  return { email, is_admin: Boolean(data?.is_admin) };
}

export default async function handler(req, res) {
  const actor = await resolveActor(req, res);
  if (!actor) return; // 401/403 already sent
  if (req.method === 'GET') return getBoard(req, res, actor);
  if (req.method === 'POST') return handlePost(req, res, actor);
  if (req.method === 'DELETE') return removeStrokes(req, res, actor);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getBoard(req, res, actor) {
  const week = req.query.week;
  if (!week || !WEEK_RE.test(week)) {
    return res.status(400).json({ error: 'week is required (YYYY-MM-DD, the Monday)' });
  }
  const me = { email: actor.email, is_admin: actor.is_admin };
  if (!hasDb()) return res.status(200).json({ source: 'mock', members: [], strokes: [], notes: [], me });
  try {
    const db = getDb();
    const [membersRes, strokesRes, notesRes] = await Promise.all([
      db.from('delegation_members')
        .select('name, clerk_email, is_admin, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      db.from('delegation_strokes')
        .select('id, week_key, row_owner_email, points, color, created_by_email, created_at')
        .eq('week_key', week)
        .order('created_at', { ascending: true }),
      db.from('delegation_notes')
        .select('id, week_key, row_owner_email, day_index, text, created_by_email, updated_at')
        .eq('week_key', week),
    ]);
    if (membersRes.error) throw membersRes.error;
    if (strokesRes.error) throw strokesRes.error;
    if (notesRes.error) throw notesRes.error;
    res.status(200).json({
      source: 'supabase',
      members: membersRes.data || [],
      strokes: strokesRes.data || [],
      notes: notesRes.data || [],
      me,
    });
  } catch (err) {
    console.error('[api/delegation GET]', err);
    res.status(500).json({ error: err.message });
  }
}

// POST dispatch: a body with `day_index` is a typed note; otherwise an ink stroke.
async function handlePost(req, res, actor) {
  if (req.body && req.body.day_index != null) return saveNote(req, res, actor);
  return addStroke(req, res, actor);
}

async function saveNote(req, res, actor) {
  const { week, row_owner_email, day_index, text } = req.body || {};
  if (!week || !WEEK_RE.test(week)) return res.status(400).json({ error: 'week is required (YYYY-MM-DD)' });
  if (!row_owner_email) return res.status(400).json({ error: 'row_owner_email is required' });
  if (!Number.isInteger(day_index) || day_index < 0 || day_index > 4) {
    return res.status(400).json({ error: 'day_index must be 0..4' });
  }
  if (typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_NOTE) return res.status(400).json({ error: 'note too long' });

  // Same gate as drawing: your own row, or admin.
  if (!canWrite(actor, row_owner_email)) {
    return res.status(403).json({ error: 'You can only edit notes in your own row' });
  }

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    const trimmed = text.trim();
    // Blank note = clear the cell.
    if (!trimmed) {
      const { error } = await db
        .from('delegation_notes')
        .delete()
        .eq('week_key', week)
        .eq('row_owner_email', row_owner_email)
        .eq('day_index', day_index);
      if (error) throw error;
      return res.status(200).json({ source: 'supabase', note: null });
    }
    const { data, error } = await db
      .from('delegation_notes')
      .upsert(
        {
          week_key: week,
          row_owner_email,
          day_index,
          text: trimmed,
          created_by_email: actor.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'week_key,row_owner_email,day_index' },
      )
      .select('id, week_key, row_owner_email, day_index, text, created_by_email, updated_at')
      .single();
    if (error) throw error;
    res.status(200).json({ source: 'supabase', note: data });
  } catch (err) {
    console.error('[api/delegation POST note]', err);
    res.status(500).json({ error: err.message });
  }
}

async function addStroke(req, res, actor) {
  const { week, row_owner_email, points, color } = req.body || {};
  if (!week || !WEEK_RE.test(week)) return res.status(400).json({ error: 'week is required (YYYY-MM-DD)' });
  if (!row_owner_email) return res.status(400).json({ error: 'row_owner_email is required' });
  if (!Array.isArray(points) || points.length === 0) return res.status(400).json({ error: 'points must be a non-empty array' });
  if (points.length > MAX_POINTS) return res.status(400).json({ error: 'stroke too large' });

  // Server-side gate: you can only write your own row unless you're the admin.
  if (!canWrite(actor, row_owner_email)) {
    return res.status(403).json({ error: 'You can only draw in your own row' });
  }

  const strokeColor = HEX_RE.test(color || '') ? color : '#111111';
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();
    const { data, error } = await db
      .from('delegation_strokes')
      .insert({
        week_key: week,
        row_owner_email,
        points,
        color: strokeColor,
        created_by_email: actor.email,
      })
      .select('id, week_key, row_owner_email, points, color, created_by_email, created_at')
      .single();
    if (error) throw error;
    res.status(200).json({ source: 'supabase', stroke: data });
  } catch (err) {
    console.error('[api/delegation POST]', err);
    res.status(500).json({ error: err.message });
  }
}

async function removeStrokes(req, res, actor) {
  const { id, week, row_owner_email, clearRow } = req.body || {};
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  const db = getDb();

  try {
    // Clear a whole row for a week (same permission as drawing in it).
    if (clearRow) {
      if (!week || !WEEK_RE.test(week)) return res.status(400).json({ error: 'week is required (YYYY-MM-DD)' });
      if (!row_owner_email) return res.status(400).json({ error: 'row_owner_email is required' });
      if (!canWrite(actor, row_owner_email)) {
        return res.status(403).json({ error: 'You can only clear your own row' });
      }
      const { error } = await db
        .from('delegation_strokes')
        .delete()
        .eq('week_key', week)
        .eq('row_owner_email', row_owner_email);
      if (error) throw error;
      return res.status(200).json({ source: 'supabase', cleared: true });
    }

    // Delete a single stroke (undo). Must own it, or be admin.
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { data: stroke, error: selErr } = await db
      .from('delegation_strokes')
      .select('id, created_by_email, row_owner_email')
      .eq('id', id)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!stroke) return res.status(404).json({ error: 'Stroke not found' });
    if (!canDelete(actor, stroke)) {
      return res.status(403).json({ error: 'You can only remove your own strokes' });
    }
    const { error } = await db.from('delegation_strokes').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', deleted: id });
  } catch (err) {
    console.error('[api/delegation DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}
