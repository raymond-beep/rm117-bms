// GET /api/jobs/checkset-files — a job's drawing sets from its Drive "Checksets"
// folder, for the Drawing QA tab.
//   ?jobId=            -> list files in the job's Drive "Checksets" folder
//   ?jobId=&fileId=    -> stream that file's bytes (application/pdf) for review.
//                         fileId is validated to belong to the job's Checksets
//                         folder, so this is never an open Drive file proxy.
// Staff-gated (read-only; the service account is Drive Viewer + drive.file).
// Mirrors api/jobs/proposal-docs.js — same folder-memoize + parents-validation.
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';
import {
  hasDrive,
  resolveChecksetsFolderId,
  listFolderFiles,
  getFileMeta,
  streamFileTo,
} from '../_lib/google-drive.js';

// A job's Checksets-folder id essentially never changes, but resolving it costs
// 2–3 serial Drive calls — memoize per warm instance. Only found folders are
// cached, so a newly created Checksets subfolder shows up on the next request.
const FOLDER_TTL_MS = 10 * 60_000;
const _folderCache = new Map(); // jobId -> { at:number, folderId:string }

async function checksetsFolderId(jobId) {
  const hit = _folderCache.get(jobId);
  if (hit && Date.now() - hit.at < FOLDER_TTL_MS) return hit.folderId;
  const folderId = await resolveChecksetsFolderId(jobId);
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
    folderId = await checksetsFolderId(jobId);
  } catch (err) {
    console.error('[checkset-files] resolve folder', err);
    return res.status(502).json({ error: 'Could not reach Google Drive' });
  }
  if (!folderId) {
    // No Checksets subfolder for this job yet — not an error, just nothing to show.
    return res.status(200).json({ configured: true, folder: null, files: [] });
  }

  // Stream one file (validated to live in this job's Checksets folder — same
  // parents check as portal/download, one metadata call instead of a folder list).
  if (fileId) {
    let meta;
    try {
      meta = await getFileMeta(fileId);
    } catch (err) {
      console.error('[checkset-files] file meta', err);
      return res.status(404).json({ error: 'File not in this job’s Checksets folder' });
    }
    if (!meta?.parents?.includes(folderId)) {
      return res.status(404).json({ error: 'File not in this job’s Checksets folder' });
    }
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    try {
      await streamFileTo(fileId, res);
    } catch (err) {
      console.error('[checkset-files] stream', err);
      if (!res.headersSent) res.status(502).json({ error: 'Could not read the file' });
    }
    return;
  }

  // List (most-recent first; the Drive helper already orders by modifiedTime desc).
  let files;
  try {
    files = await listFolderFiles(folderId);
  } catch (err) {
    console.error('[checkset-files] list files', err);
    return res.status(502).json({ error: 'Could not list the Checksets folder' });
  }
  // Attach each file's review status (uploaded | in_review | reviewed) from any
  // drawing_sets row already opened for this (job, Drive file). Files never opened
  // have no row → status stays null (no badge). Best-effort: a DB hiccup here just
  // omits the badges, it doesn't fail the listing.
  const statusByFile = new Map();
  const db = getDb();
  if (db) {
    try {
      const { data: sets } = await db
        .from('drawing_sets')
        .select('drive_file_id, status')
        .eq('job_number', jobId);
      for (const s of sets ?? []) statusByFile.set(s.drive_file_id, s.status);
    } catch (err) {
      console.error('[checkset-files] set statuses', err);
    }
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
      reviewStatus: statusByFile.get(f.id) ?? null,
    })),
  });
}
