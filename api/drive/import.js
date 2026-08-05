// POST /api/drive/import — pull one Drive folder into the app as a job or a lead,
// or dismiss it so the queue stops offering it.
//
//   { folderId, phase?, client_name?, address?, set_up_folders? }  -> create the job/lead row
//   { folderId, dismiss: true }                                    -> never offer this folder again
//
// The folder is re-read from Drive and re-parsed HERE rather than trusting the client's
// copy: the queue payload is a snapshot, and a folder renamed between the scan and the
// click must not mint a Job ID nobody chose. The Job ID is the QuickBooks key.
//
// The row is created UNLINKED to a client (client_id null, import_needs_review set): the
// folder gives a surname, and "Deuel" names five different projects here. Guessing the
// client record wrong is worse than leaving it for a staffer to pick — the Details tab
// already has the picker.
import { getDb, hasDb, PHASES, isPlaceholderJobId } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasDrive, getFileMeta, ensureJobSubfolders } from '../_lib/google-drive.js';
import { parseFolderName } from '../_lib/drive-sync.js';
import { stampPhaseEntry } from '../_lib/phase-clock.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const staffId = await requireStaff(req, res); // the Clerk user id, or 'local-dev'
  if (!staffId) return; // 401/403 already sent
  if (!hasDb()) return res.status(503).json({ error: 'No database configured' });
  if (!hasDrive()) return res.status(503).json({ error: 'No Drive configured' });

  const { folderId, dismiss } = req.body || {};
  if (!folderId) return res.status(400).json({ error: 'folderId is required' });

  const db = getDb();

  if (dismiss) {
    const { error } = await db.from('drive_sync_dismissed').upsert({
      drive_folder_id: folderId,
      folder_name: req.body.folder_name || null,
      dismissed_by: staffId,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ dismissed: true, folderId });
  }

  try {
    // Re-read the folder from Drive — the truth, not the queue's snapshot of it.
    const meta = await getFileMeta(folderId);
    if (!meta?.name) return res.status(404).json({ error: 'That folder no longer exists in Drive' });

    const parsed = parseFolderName(meta.name);
    if (!parsed) {
      return res.status(400).json({
        error: `"${meta.name}" isn't a job folder — it has to be named YY_NNN_Name or YY_XXX_Name.`,
      });
    }

    // A numbered Job ID must equal the folder name AND the QBO Customer Display Name,
    // character for character. If the folder has stray spaces, importing the tidied
    // version would leave the app and Drive disagreeing — and QBO payments match on
    // that name. Refuse, and say what to rename it to. (Leads are exempt: a placeholder
    // id never reaches QuickBooks or Drive-by-name.)
    if (parsed.kind === 'job' && parsed.jobId !== meta.name.trim()) {
      return res.status(400).json({
        error: `Rename the folder to “${parsed.jobId}” in Drive first — the Job ID, the folder, and QuickBooks all have to match exactly.`,
      });
    }

    const phase = req.body.phase || parsed.suggestedPhase;
    if (!PHASES.includes(phase)) return res.status(400).json({ error: `Invalid phase: ${phase}` });

    // A numbered folder is signed work and must NOT come in as a lead — a lead's id is a
    // placeholder, and promoting it later would assign a SECOND number to a job that
    // already has one (and already has a folder named after the first).
    if (parsed.kind === 'job' && isPlaceholderJobId(parsed.jobId)) {
      return res.status(400).json({ error: 'A numbered folder cannot be imported as a lead.' });
    }

    const row = {
      job_id: parsed.jobId,
      client_id: null,
      client_name: req.body.client_name || parsed.clientName || 'Unknown',
      address: req.body.address || null,
      phase,
      // Start the phase clock at import. Every one of the 29 jobs that had no timeline row
      // at all (measured 2026-07-25) came in through here — see api/_lib/phase-clock.js.
      phase_since: new Date().toISOString(),
      job_total: 0,
      amount_billed: 0,
      bill_flag: false,
      is_forefront: parsed.isForefront,
      // Fire Escape is its OWN work type — not Forefront, not a developer (Ray).
      is_fire_escape: parsed.isFireEscape,
      // The folder already exists — remember WHERE. Promotion renames this folder rather
      // than provisioning a second one beside it (api/_lib/job-number.js).
      drive_folder_id: folderId,
      import_needs_review: true,
      import_notes: `Imported from the Drive folder "${meta.name}" on ${new Date().toISOString().slice(0, 10)}. Client not linked yet; contract total unset.`,
    };

    const { data, error } = await db.from('jobs').insert(row).select().single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: `${parsed.jobId} is already in the app.` });
      }
      throw error;
    }

    // Start the phase clock. Best-effort — never fail an import over the side record.
    await stampPhaseEntry(db, parsed.jobId, phase, { where: 'api/drive/import' });

    // Fill in the standard folder tree INSIDE the folder that already exists (Ray, 2026-08-04).
    // Until now the tree was only back-filled at PROMOTION — when the proposal is signed — which
    // is one step too late: the proposal is WRITTEN before it's signed, so Ang would go to file
    // one and find no "Proposal" folder. Measured the day this changed: 4 of 26 live leads had
    // none, and 26_xxx_Tambakuwala's proposal .docx + .pdf were sitting loose at the folder root
    // because there was nowhere to put them.
    //
    // ⚠️ This does NOT provision a folder named after a placeholder Job ID — the invariant that a
    // `26_xxx_` id never reaches Drive-by-name still holds. The folder is already there and was
    // named by a person; we only add subfolders inside it. `ensureJobSubfolders` is idempotent and
    // matches case-insensitively, so an existing "Proposal" is reused, never duplicated, and
    // nothing already in the folder is touched or moved.
    //
    // Ray's call on the trade: worst case a lead falls through and someone deletes a few empty
    // folders. That beats having nowhere to save the proposal that might win the job.
    const setUpFolders = req.body.set_up_folders !== false; // opt OUT, not in
    let drive = setUpFolders ? null : { skipped: 'not requested' };
    if (setUpFolders) {
      try {
        const { filesSentId, created } = await ensureJobSubfolders(folderId);
        if (filesSentId) {
          await db.from('jobs')
            .update({ drive_files_sent_folder_id: filesSentId })
            .eq('job_id', parsed.jobId);
          data.drive_files_sent_folder_id = filesSentId;
        }
        drive = { subfoldersCreated: created };
      } catch (e) {
        // Non-fatal, exactly as in api/jobs/create.js: a Drive hiccup must never undo an import
        // that already wrote the job row. The staffer sees what didn't happen and can retry.
        console.warn('[api/drive/import] subfolder set-up failed (job still imported):', e.message);
        drive = { error: e.message };
      }
    }

    res.status(201).json({ job: data, folderName: meta.name, drive });
  } catch (err) {
    console.error('[api/drive/import]', err);
    res.status(500).json({ error: err.message });
  }
}
