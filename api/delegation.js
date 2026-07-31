// /api/delegation — the weekly Delegation Board (internal, staff-only).
//
// Replaces Angelena's hand-drawn paper delegation sheet: a Mon–Fri × employee grid,
// one board per week (keyed by the Monday date). Each cell is a **checklist** —
// items you tick off, struck through when done.
//
//   GET    ?week=YYYY-MM-DD                       -> { members, tasks, me }
//   POST   { week, row_owner_email, day_index,    -> add one task (appended)
//            text }
//   PATCH  { id, done }                           -> tick / untick
//   PATCH  { id, text }                           -> rename
//   DELETE { id }                                 -> remove one task
//   DELETE { week, row_owner_email, clearRow }    -> clear a whole row for the week
//
// ⚠️ **THE PEN IS GONE** (Ray's call 2026-07-31). Ink was Angelena's request and she
// never used it: `delegation_strokes` held **2 rows** in the board's entire life,
// while the typed notes had 31 — every one written by her, and already written as
// one item per line. So the board became what it was actually being used as. The
// `delegation_strokes` and `delegation_notes` tables are deliberately left in place
// (notes are what migration 0022 backfilled the tasks FROM, which is what makes the
// conversion reversible); nothing reads or writes them any more.
//
// PERMISSIONS (enforced here, server-side — NOT in the browser and NOT via RLS,
// because this app reaches Supabase only through the service-role key). A signed-in
// staff member may edit only their OWN row; the admin (Angelena) may edit ANY row.
// Reads are open to all staff — full visibility is the whole point of the board.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';
import { getUserEmail } from './_lib/clerk.js';

// --- Pure permission helpers (unit-tested in tests/delegation-perms.test.js) ---

// The shared "Everyone" lane at the top of the board — a firm-wide row (e.g. a
// measure-up that applies to the whole studio) that admins fill once instead of
// writing into all five people's boxes. It's a reserved row_owner_email (NOT a
// valid email, so it can never collide with a real Clerk login) and is admin-write
// only. Keep this value in sync with STUDIO_ROW in Delegation.jsx + MyWeekWidget.jsx.
export const STUDIO_ROW = '__studio__';

// Can `actor` add/edit/remove items in the row owned by `rowOwnerEmail`?
export function canWrite(actor, rowOwnerEmail) {
  if (!actor) return false;
  if (actor.is_admin) return true;
  if (rowOwnerEmail === STUDIO_ROW) return false; // shared lane is admin-only
  return Boolean(actor.email) && actor.email === rowOwnerEmail;
}

// Can `actor` modify this specific task?
//
// Keyed on the ROW the task sits in, NOT on who created it. That is deliberate:
// Angelena assigns most of these, so "only the author may touch it" would mean
// nobody could tick off their own work — the one interaction the board exists for.
// Your row is yours to check off, rename and clear; admin can do any row.
export function canModifyTask(actor, task) {
  if (!actor || !task) return false;
  return canWrite(actor, task.row_owner_email);
}

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TASK = 500;      // one checklist line; a paragraph belongs in the job notes
const MAX_PER_CELL = 100;  // guards a runaway paste from becoming an unusable cell

const TASK_COLS = 'id, week_key, row_owner_email, day_index, text, done, done_at, '
  + 'done_by_email, position, created_by_email, created_at, updated_at';

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
  if (req.method === 'POST') return addTask(req, res, actor);
  if (req.method === 'PATCH') return updateTask(req, res, actor);
  if (req.method === 'DELETE') return removeTasks(req, res, actor);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getBoard(req, res, actor) {
  const week = req.query.week;
  if (!week || !WEEK_RE.test(week)) {
    return res.status(400).json({ error: 'week is required (YYYY-MM-DD, the Monday)' });
  }
  const me = { email: actor.email, is_admin: actor.is_admin };
  if (!hasDb()) return res.status(200).json({ source: 'mock', members: [], tasks: [], me });
  try {
    const db = getDb();
    const [membersRes, tasksRes] = await Promise.all([
      db.from('delegation_members')
        .select('name, clerk_email, is_admin, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      db.from('delegation_tasks')
        .select(TASK_COLS)
        .eq('week_key', week)
        // Order matters: Ang writes a day top to bottom and the sequence carries
        // meaning (a 9:30 walkthrough before an 11:00 measure), so this is manual
        // `position`, never created_at. created_at only breaks ties.
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);
    if (membersRes.error) throw membersRes.error;
    if (tasksRes.error) throw tasksRes.error;
    res.status(200).json({
      source: 'supabase',
      members: membersRes.data || [],
      tasks: tasksRes.data || [],
      me,
    });
  } catch (err) {
    console.error('[api/delegation GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function addTask(req, res, actor) {
  const { week, row_owner_email, day_index, text } = req.body || {};
  if (!week || !WEEK_RE.test(week)) return res.status(400).json({ error: 'week is required (YYYY-MM-DD)' });
  if (!row_owner_email) return res.status(400).json({ error: 'row_owner_email is required' });
  if (!Number.isInteger(day_index) || day_index < 0 || day_index > 4) {
    return res.status(400).json({ error: 'day_index must be 0..4' });
  }
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return res.status(400).json({ error: 'text is required' });
  if (body.length > MAX_TASK) return res.status(400).json({ error: 'task too long' });

  if (!canWrite(actor, row_owner_email)) {
    return res.status(403).json({ error: 'You can only add items to your own row' });
  }

  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  try {
    const db = getDb();

    const { count } = await db
      .from('delegation_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('week_key', week)
      .eq('row_owner_email', row_owner_email)
      .eq('day_index', day_index);
    if ((count || 0) >= MAX_PER_CELL) {
      return res.status(400).json({ error: 'That day already has the maximum number of items' });
    }

    // Append: one past the current highest position in this cell. Read-then-write
    // is fine here — a cell is one person's short list, not a contended counter,
    // and a tie just means two items share a position and fall back to created_at.
    const { data: last } = await db
      .from('delegation_tasks')
      .select('position')
      .eq('week_key', week)
      .eq('row_owner_email', row_owner_email)
      .eq('day_index', day_index)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await db
      .from('delegation_tasks')
      .insert({
        week_key: week,
        row_owner_email,
        day_index,
        text: body,
        position: (last?.position ?? -1) + 1,
        created_by_email: actor.email,
      })
      .select(TASK_COLS)
      .single();
    if (error) throw error;
    res.status(200).json({ source: 'supabase', task: data });
  } catch (err) {
    console.error('[api/delegation POST]', err);
    res.status(500).json({ error: err.message });
  }
}

async function updateTask(req, res, actor) {
  const { id, done, text } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (done === undefined && text === undefined) {
    return res.status(400).json({ error: 'nothing to update' });
  }
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });

  try {
    const db = getDb();
    const { data: task, error: selErr } = await db
      .from('delegation_tasks')
      .select('id, row_owner_email')
      .eq('id', id)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canModifyTask(actor, task)) {
      return res.status(403).json({ error: 'You can only change items in your own row' });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (done !== undefined) {
      patch.done = Boolean(done);
      // Stamped on tick, CLEARED on untick — so an un-ticked item never carries a
      // stale "completed by Tom at 4pm" that nobody would think to look at.
      patch.done_at = patch.done ? new Date().toISOString() : null;
      patch.done_by_email = patch.done ? actor.email : null;
    }
    if (text !== undefined) {
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) return res.status(400).json({ error: 'text cannot be empty — delete the item instead' });
      if (body.length > MAX_TASK) return res.status(400).json({ error: 'task too long' });
      patch.text = body;
    }

    const { data, error } = await db
      .from('delegation_tasks')
      .update(patch)
      .eq('id', id)
      .select(TASK_COLS)
      .single();
    if (error) throw error;
    res.status(200).json({ source: 'supabase', task: data });
  } catch (err) {
    console.error('[api/delegation PATCH]', err);
    res.status(500).json({ error: err.message });
  }
}

async function removeTasks(req, res, actor) {
  const { id, week, row_owner_email, clearRow } = req.body || {};
  if (!hasDb()) return res.status(200).json({ source: 'mock', persisted: false });
  const db = getDb();

  try {
    // Clear a whole row for a week (same permission as writing in it).
    if (clearRow) {
      if (!week || !WEEK_RE.test(week)) return res.status(400).json({ error: 'week is required (YYYY-MM-DD)' });
      if (!row_owner_email) return res.status(400).json({ error: 'row_owner_email is required' });
      if (!canWrite(actor, row_owner_email)) {
        return res.status(403).json({ error: 'You can only clear your own row' });
      }
      const { error } = await db
        .from('delegation_tasks')
        .delete()
        .eq('week_key', week)
        .eq('row_owner_email', row_owner_email);
      if (error) throw error;
      return res.status(200).json({ source: 'supabase', cleared: true });
    }

    if (!id) return res.status(400).json({ error: 'id is required' });
    const { data: task, error: selErr } = await db
      .from('delegation_tasks')
      .select('id, row_owner_email')
      .eq('id', id)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canModifyTask(actor, task)) {
      return res.status(403).json({ error: 'You can only remove items from your own row' });
    }
    const { error } = await db.from('delegation_tasks').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ source: 'supabase', deleted: id });
  } catch (err) {
    console.error('[api/delegation DELETE]', err);
    res.status(500).json({ error: err.message });
  }
}
