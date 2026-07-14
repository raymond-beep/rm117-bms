// POST /api/jobs/create — new-job creation from the app (Phase 3; replaces
// entering jobs in the Sheet). Job ID must match YY_NNN_[FF_]LastName — it is
// the shared key across Drive, QBO, and Supabase.
import { getDb, hasDb, JOB_ID_RE, PHASES, isPlaceholderJobId } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasDrive, provisionJobFolders } from '../_lib/google-drive.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const body = req.body || {};
  const { job_id, client_name } = body;

  if (!job_id || !JOB_ID_RE.test(job_id)) {
    return res.status(400).json({
      error: 'job_id is required and must match YY_NNN_[FF_]LastName (e.g. 26_012_Smith or 26_012_FF_Smith)',
    });
  }
  if (!client_name) return res.status(400).json({ error: 'client_name is required' });

  const phase = body.phase || 'potential';
  if (!PHASES.includes(phase)) {
    return res.status(400).json({ error: `Invalid phase: ${phase}` });
  }

  const row = {
    job_id,
    client_id: body.client_id || null,
    referred_by_id: body.referred_by_id || null,
    client_name,
    address: body.address || null,
    phase,
    job_total: body.job_total || 0,
    amount_billed: 0,
    bill_flag: false,
    is_forefront: body.is_forefront ?? job_id.includes('_FF_'),
    // FE_ = Fire Escape — its own work type, NOT Forefront and not a developer (Ray).
    is_fire_escape: body.is_fire_escape ?? job_id.includes('_FE_'),
    ff_commission: body.ff_commission || null,
    notes: body.notes || null,
  };

  if (!hasDb()) {
    return res.status(200).json({ source: 'mock', persisted: false, job: row });
  }

  try {
    const db = getDb();
    const { data, error } = await db.from('jobs').insert(row).select().single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: `Job ${job_id} already exists` });
      }
      throw error;
    }

    // Best-effort: provision the job's Drive folder tree (keyed by Job ID) and
    // persist its "Files Sent" id for the portal vault. Non-fatal — a Drive
    // hiccup must never fail job creation; the self-heal can map it later.
    // A LEAD (`26_xxx_Smith`) gets NO Drive folder: the folder is named after the Job ID,
    // and a placeholder folder would only have to be renamed when the proposal is signed.
    // It's provisioned at promotion instead (api/_lib/job-number.js).
    let drive = null;
    if (isPlaceholderJobId(job_id)) {
      drive = { skipped: 'lead — folder is created when the proposal is signed' };
    } else if (hasDrive()) {
      try {
        const prov = await provisionJobFolders(job_id);
        if (prov.ok) {
          drive = { created: prov.created, folderId: prov.folderId };
          if (prov.filesSentId) {
            await db.from('jobs')
              .update({ drive_files_sent_folder_id: prov.filesSentId })
              .eq('job_id', job_id);
            data.drive_files_sent_folder_id = prov.filesSentId;
          }
        } else {
          drive = { error: prov.reason };
        }
      } catch (e) {
        console.warn('[api/jobs/create] Drive provisioning failed (job still created):', e.message);
        drive = { error: e.message };
      }
    }

    res.status(201).json({ source: 'supabase', persisted: true, job: data, drive });
  } catch (err) {
    console.error('[api/jobs/create]', err);
    res.status(500).json({ error: err.message });
  }
}
