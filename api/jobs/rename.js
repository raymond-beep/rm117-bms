// POST /api/jobs/rename — the "Correct Job ID" flow.
//
// The Job ID is the shared key across three systems (App/Supabase, QuickBooks
// customer DisplayName, Google Drive folder). Renaming it in only one would
// desync them — the very problem this guards against — so this renames it across
// all three together, and rolls back completed steps if a later one fails.
//
// Body: { old_job_id, new_job_id, dry_run? }
//   dry_run: true  → returns a preview (what would change) and mutates nothing.
//   dry_run: false → executes: DB (cascades to child rows) → QBO → Drive.
//
// Requires migration 0007 (ON UPDATE CASCADE on jobs(job_id) FKs) — without it the
// DB step fails first and nothing external is touched (the safe failure).
import { getDb, hasDb, JOB_ID_RE } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, findCustomerByDisplayName, renameCustomer } from '../_lib/qbo.js';
import { hasDrive, findJobFolder, renameFolder } from '../_lib/google-drive.js';

// Tables whose job_id FK cascades on the jobs rename (for the preview counts).
const CHILD_TABLES = ['payments', 'invoices', 'proposals', 'letters', 'field_notes', 'job_phase_events', 'file_records'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' });

  const { old_job_id, new_job_id, dry_run = false } = req.body || {};
  if (!old_job_id) return res.status(400).json({ error: 'old_job_id is required' });
  if (!new_job_id || !JOB_ID_RE.test(new_job_id)) {
    return res.status(400).json({ error: 'new_job_id must match YY_NNN_[FF_]LastName (spaces allowed, no leading/trailing space)' });
  }
  if (old_job_id === new_job_id) return res.status(400).json({ error: 'new_job_id is the same as old_job_id' });

  const db = getDb();

  // The job must exist under the old id, and the new id must be free.
  const { data: oldJob } = await db.from('jobs').select('job_id').eq('job_id', old_job_id).maybeSingle();
  if (!oldJob) return res.status(404).json({ error: `No job "${old_job_id}"` });
  const { data: clash } = await db.from('jobs').select('job_id').eq('job_id', new_job_id).maybeSingle();
  if (clash) return res.status(409).json({ error: `A job named "${new_job_id}" already exists in the app` });

  // ── Preflight (read-only): what would change? ──
  const children = {};
  for (const t of CHILD_TABLES) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true }).eq('job_id', old_job_id);
    children[t] = count || 0;
  }

  const qbo = { configured: hasQbo(), present: false };
  if (qbo.configured) {
    try {
      qbo.present = Boolean(await findCustomerByDisplayName(old_job_id));
      if (qbo.present) qbo.newNameTaken = Boolean(await findCustomerByDisplayName(new_job_id));
    } catch (e) { qbo.error = e.message; }
  }

  const drive = { configured: hasDrive(), present: false, exact: false };
  if (drive.configured) {
    try {
      const f = await findJobFolder(old_job_id);
      if (f) { drive.present = true; drive.exact = f.exact; drive.folderId = f.id; drive.folderName = f.name; }
    } catch (e) { drive.error = e.message; }
  }

  const preview = {
    old_job_id,
    new_job_id,
    app: { records: children, total: Object.values(children).reduce((a, b) => a + b, 0) },
    quickbooks: qbo,
    drive,
  };

  if (dry_run) return res.status(200).json({ dry_run: true, preview });

  // Refuse if the new name already belongs to a DIFFERENT QBO customer (would merge/confuse).
  if (qbo.present && qbo.newNameTaken) {
    return res.status(409).json({
      error: `QuickBooks already has a customer named "${new_job_id}". Resolve that before renaming.`,
      preview,
    });
  }

  // ── Execute: DB → QBO → Drive, rolling back completed steps on failure ──
  // DB first: if migration 0007 is missing the DB step fails before anything
  // external changes (the cleanest failure), and DB rollback is the most reliable.
  const done = [];
  const report = { old_job_id, new_job_id, steps: {} };
  try {
    // 1) DB (cascades to child rows via ON UPDATE CASCADE).
    const { error: dbErr } = await db.from('jobs').update({ job_id: new_job_id }).eq('job_id', old_job_id);
    if (dbErr) throw new Error(`App DB rename failed (is migration 0007 applied?): ${dbErr.message}`);
    done.push('db');
    report.steps.app = `renamed (${preview.app.total} linked record${preview.app.total === 1 ? '' : 's'} moved)`;

    // 2) QuickBooks customer DisplayName.
    if (qbo.present) {
      await renameCustomer(old_job_id, new_job_id);
      done.push('qbo');
      report.steps.quickbooks = 'customer renamed';
    } else {
      report.steps.quickbooks = qbo.configured ? 'skipped (no matching customer in QuickBooks)' : 'skipped (QuickBooks not configured)';
    }

    // 3) Drive folder — only when the folder name is exactly the Job ID.
    if (drive.present && drive.exact) {
      await renameFolder(drive.folderId, new_job_id);
      done.push('drive');
      report.steps.drive = 'folder renamed';
    } else if (drive.present && !drive.exact) {
      report.steps.drive = `skipped (folder "${drive.folderName}" has extra text — rename it manually)`;
    } else {
      report.steps.drive = drive.configured ? 'skipped (no folder found)' : 'skipped (Drive not configured)';
    }

    return res.status(200).json({ ok: true, report });
  } catch (err) {
    // Roll back whatever completed, in reverse order. Report any rollback that fails.
    const rollback = [];
    for (const step of [...done].reverse()) {
      try {
        if (step === 'db') await db.from('jobs').update({ job_id: old_job_id }).eq('job_id', new_job_id);
        if (step === 'qbo') await renameCustomer(new_job_id, old_job_id);
        if (step === 'drive') await renameFolder(drive.folderId, old_job_id);
        rollback.push(`${step}: reverted`);
      } catch (rbErr) {
        rollback.push(`${step}: ROLLBACK FAILED — ${rbErr.message} — FIX MANUALLY`);
      }
    }
    console.error('[api/jobs/rename]', err, 'rollback:', rollback);
    return res.status(502).json({ ok: false, error: err.message, completed: done, rollback, report });
  }
}
