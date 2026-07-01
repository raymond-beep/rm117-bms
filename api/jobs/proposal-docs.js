// GET /api/jobs/proposal-docs — surface a job's signed proposal(s) from Drive.
// The signed proposal PDF is the contract of record (complete fee schedule + terms),
// so staff can read it right where they invoice — no data entry, no backlog.
//   ?jobId=            -> list files in the job's Drive "Proposal" folder
//   ?jobId=&fileId=    -> stream that file's bytes (application/pdf, etc.) for an
//                         in-app viewer. fileId is validated to belong to the job's
//                         proposal folder, so this is never an open Drive file proxy.
// Staff-gated (read-only; the service account is Drive Viewer + drive.file).
import { requireStaff } from '../_lib/require-staff.js';
import {
  hasDrive,
  resolveProposalFolderId,
  listFolderFiles,
  streamFileTo,
} from '../_lib/google-drive.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const jobId = req.query?.jobId;
  const fileId = req.query?.fileId;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  if (!hasDrive()) return res.status(200).json({ configured: false, files: [] });

  let folderId;
  try {
    folderId = await resolveProposalFolderId(jobId);
  } catch (err) {
    console.error('[proposal-docs] resolve folder', err);
    return res.status(502).json({ error: 'Could not reach Google Drive' });
  }
  if (!folderId) {
    // No Proposal subfolder for this job yet — not an error, just nothing to show.
    return res.status(200).json({ configured: true, folder: null, files: [] });
  }

  let files;
  try {
    files = await listFolderFiles(folderId);
  } catch (err) {
    console.error('[proposal-docs] list files', err);
    return res.status(502).json({ error: 'Could not list the proposal folder' });
  }

  // Stream one file (validated to live in this job's proposal folder).
  if (fileId) {
    const match = files.find((f) => f.id === fileId);
    if (!match) return res.status(404).json({ error: 'File not in this job’s proposal folder' });
    res.setHeader('Content-Type', match.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(match.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    try {
      await streamFileTo(fileId, res);
    } catch (err) {
      console.error('[proposal-docs] stream', err);
      if (!res.headersSent) res.status(502).json({ error: 'Could not read the file' });
    }
    return;
  }

  // List (most-recent first; the Drive helper already orders by modifiedTime desc).
  return res.status(200).json({
    configured: true,
    folder: folderId,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size != null ? Number(f.size) : null,
      modifiedTime: f.modifiedTime || null,
      viewable: f.mimeType === 'application/pdf',
    })),
  });
}
