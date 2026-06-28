// /api/deliver — file a generated PDF into a job's Google Drive folder (staff-only).
//   POST { jobId, kind: 'letter'|'proposal', filename, pdf }  -> upload + log
//     pdf      = base64 of the assembled PDF bytes (no data: prefix)
//     letters   land in the job's "Files Sent" folder (the client-portal vault)
//     proposals land in the job's separate "Proposal" folder (firm filing)
//
// The PDF is built in the browser (pdf-lib); this endpoint only relays the bytes
// to Drive and records the delivery in `file_records`. The caller's clean name is
// kept as-is (e.g. "Building Department Letter 06.28.26.pdf"); a same-name file in
// the folder gets a " (2)" suffix rather than an overwrite, so nothing is clobbered.
//
// Requires the service account to have content-writer access on the Shared Drive;
// until that role is granted, Drive uploads 403 and this returns 502 with a hint.
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';
import {
  hasDrive,
  resolveFilesSentFolderId,
  resolveProposalFolderId,
  listFolderFiles,
  uploadToFolder,
} from './_lib/google-drive.js';

const KINDS = {
  letter: { folder: 'files_sent', resolve: resolveFilesSentFolderId, label: 'Files Sent' },
  proposal: { folder: 'proposal', resolve: resolveProposalFolderId, label: 'Proposal' },
};

// Keep the caller's clean name (e.g. "Building Department Letter 06.28.26.pdf").
// Only if that exact name already exists in the folder do we add a " (2)" suffix,
// so we never silently create two identically-named files or overwrite one.
function cleanBase(filename) {
  return String(filename || 'document.pdf').replace(/\.pdf$/i, '').replace(/[\\/]+/g, '-').trim() || 'document';
}
async function uniqueName(folderId, base) {
  const taken = new Set((await listFolderFiles(folderId)).map((f) => f.name));
  if (!taken.has(`${base}.pdf`)) return `${base}.pdf`;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n}).pdf`;
    if (!taken.has(candidate)) return candidate;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const staffId = await requireStaff(req, res);
  if (!staffId) return;

  const { jobId, kind, filename, pdf } = req.body || {};
  const spec = KINDS[kind];
  if (!spec) return res.status(400).json({ error: "kind must be 'letter' or 'proposal'" });
  if (!jobId) return res.status(400).json({ error: 'Select a job before sending to Drive' });
  if (!pdf || typeof pdf !== 'string') return res.status(400).json({ error: 'pdf (base64) is required' });
  if (!hasDrive()) return res.status(503).json({ error: 'Google Drive is not configured' });

  let bytes;
  try {
    bytes = Buffer.from(pdf, 'base64');
    if (!bytes.length) throw new Error('empty');
  } catch {
    return res.status(400).json({ error: 'pdf must be valid base64' });
  }

  try {
    const folderId = await spec.resolve(jobId);
    if (!folderId) {
      return res.status(409).json({
        error: `No "${spec.label}" folder found in Drive for job ${jobId}. Create it in the job's Drive folder, then try again.`,
      });
    }

    const name = await uniqueName(folderId, cleanBase(filename));
    const file = await uploadToFolder(folderId, { name, mimeType: 'application/pdf', bytes });

    // Log the delivery (best-effort; the upload already succeeded). file_records
    // links to a job, so this only records when the job exists in Supabase.
    let logged = false;
    if (hasDb()) {
      const { error } = await getDb().from('file_records').insert({
        job_id: jobId,
        drive_file_id: file.id,
        filename: file.name,
        folder: spec.folder,
        direction: 'to_client',
        uploaded_by: staffId,
      });
      if (error) console.error('[api/deliver] file_records insert failed:', error.message);
      else logged = true;
    }

    return res.status(200).json({
      ok: true,
      folder: spec.label,
      file: { id: file.id, name: file.name, webViewLink: file.webViewLink || null },
      logged,
    });
  } catch (err) {
    const denied = err?.code === 403 || /insufficient|permission|forbidden/i.test(err?.message || '');
    console.error('[api/deliver]', err);
    return res.status(denied ? 502 : 500).json({
      error: denied
        ? 'Drive upload was denied — the service account needs content-writer access on the Shared Drive.'
        : err.message,
    });
  }
}
