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
  getFileMeta,
  streamFileTo,
} from '../_lib/google-drive.js';

// A job's proposal-folder id essentially never changes, but resolving it costs 2–3
// serial Drive calls — memoize per warm instance. Only found folders are cached, so
// a newly created Proposal subfolder shows up on the next request.
const FOLDER_TTL_MS = 10 * 60_000;
const _folderCache = new Map(); // jobId -> { at:number, folderId:string }

async function proposalFolderId(jobId) {
  const hit = _folderCache.get(jobId);
  if (hit && Date.now() - hit.at < FOLDER_TTL_MS) return hit.folderId;
  const folderId = await resolveProposalFolderId(jobId);
  if (folderId) _folderCache.set(jobId, { at: Date.now(), folderId });
  return folderId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const jobId = req.query?.jobId;
  const fileId = req.query?.fileId;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  if (!hasDrive()) return res.status(200).json({ configured: false, files: [] });

  let folderId;
  try {
    folderId = await proposalFolderId(jobId);
  } catch (err) {
    console.error('[proposal-docs] resolve folder', err);
    return res.status(502).json({ error: 'Could not reach Google Drive' });
  }
  if (!folderId) {
    // No Proposal subfolder for this job yet — not an error, just nothing to show.
    return res.status(200).json({ configured: true, folder: null, files: [] });
  }

  // Stream one file (validated to live in this job's proposal folder — same
  // parents check as portal/download, one metadata call instead of a folder list).
  if (fileId) {
    let meta;
    try {
      meta = await getFileMeta(fileId);
    } catch (err) {
      console.error('[proposal-docs] file meta', err);
      return res.status(404).json({ error: 'File not in this job’s proposal folder' });
    }
    if (!meta?.parents?.includes(folderId)) {
      return res.status(404).json({ error: 'File not in this job’s proposal folder' });
    }
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
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
  let files;
  try {
    files = await listFolderFiles(folderId);
  } catch (err) {
    console.error('[proposal-docs] list files', err);
    return res.status(502).json({ error: 'Could not list the proposal folder' });
  }
  res.setHeader('Cache-Control', 'private, max-age=60');
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
