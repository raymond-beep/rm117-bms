// GET /api/set-check/files — the PDFs in a job's Drive project tree, for the Set
// Check document pickers.
//   ?jobId=          -> every PDF in the project folder + its subfolders, tagged with
//                       the folder it came from; the shared window-brochure library;
//                       and a suggested document per role (schedule / rescheck /
//                       submittal)
//   ?jobId=&fileId=  -> stream that file's bytes (application/pdf). fileId is
//                       validated to live in THIS job's folders or in the brochure
//                       library, so this is never an open Drive file proxy.
// Staff-gated, read-only. Mirrors api/jobs/checkset-files.js, but spans the whole
// job tree instead of one named folder — see listJobFolderTree for why.
import { requireStaff } from '../_lib/require-staff.js';
import {
  hasDrive,
  listJobFolderTree,
  listFolderFiles,
  getFileMeta,
  streamFileTo,
  resolveBrochureFolderId,
} from '../_lib/google-drive.js';
import { pdfsOnly } from '../_lib/drive-docs.js';
import { suggestRoles } from '../_lib/set-check/doc-roles.js';

// Resolving a job's tree costs several serial Drive calls, and the three pickers on
// screen all read the same listing — memoize per warm instance. Only found trees are
// cached, so a subfolder made after a miss shows up on the next request.
const TREE_TTL_MS = 10 * 60_000;
const _treeCache = new Map(); // jobId -> { at:number, tree }

async function jobTree(jobId) {
  const hit = _treeCache.get(jobId);
  if (hit && Date.now() - hit.at < TREE_TTL_MS) return hit.tree;
  const tree = await listJobFolderTree(jobId);
  if (tree) _treeCache.set(jobId, { at: Date.now(), tree });
  return tree;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  const jobId = req.query?.jobId;
  const fileId = req.query?.fileId;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  if (!hasDrive()) return res.status(200).json({ configured: false, files: [] });

  let tree;
  let brochureFolderId;
  try {
    [tree, brochureFolderId] = await Promise.all([jobTree(jobId), resolveBrochureFolderId()]);
  } catch (err) {
    console.error('[set-check/files] resolve folders', err);
    return res.status(502).json({ error: 'Could not reach Google Drive' });
  }
  if (!tree) {
    // No Drive folder for this job yet — not an error, just nothing to pick from.
    return res.status(200).json({ configured: true, folder: null, files: [], library: [] });
  }

  const folderIds = new Set(tree.folders.map((f) => f.id));
  // The brochure library is shared, not per-job, so it is a legitimate source for
  // this job's submittal and must be streamable alongside the job's own files.
  if (brochureFolderId) folderIds.add(brochureFolderId);

  // Stream one file, validated to live somewhere in this job's tree (same parents
  // check as checkset-files, one metadata call instead of listing every folder).
  if (fileId) {
    let meta;
    try {
      meta = await getFileMeta(fileId);
    } catch (err) {
      console.error('[set-check/files] file meta', err);
      return res.status(404).json({ error: 'File not in this job’s Drive folder' });
    }
    if (!(meta?.parents || []).some((p) => folderIds.has(p))) {
      return res.status(404).json({ error: 'File not in this job’s Drive folder' });
    }
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    try {
      await streamFileTo(fileId, res);
    } catch (err) {
      console.error('[set-check/files] stream', err);
      if (!res.headersSent) res.status(502).json({ error: 'Could not read the file' });
    }
    return;
  }

  // List every folder in parallel — a job tree is ~7 folders, and doing them
  // serially is what would make this picker feel slow. The shared brochure library
  // rides along in the same batch.
  const sources = [...tree.folders];
  if (brochureFolderId) sources.push({ id: brochureFolderId, name: 'Window Specs', library: true });

  let listings;
  try {
    listings = await Promise.all(
      sources.map(async (folder) => {
        const files = await listFolderFiles(folder.id);
        return pdfsOnly(files).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size != null ? Number(f.size) : null,
          modifiedTime: f.modifiedTime || null,
          folderId: folder.id,
          folderName: folder.name,
          library: Boolean(folder.library),
        }));
      }),
    );
  } catch (err) {
    console.error('[set-check/files] list files', err);
    return res.status(502).json({ error: 'Could not list this job’s Drive folders' });
  }

  const all = listings.flat();
  const files = all.filter((f) => !f.library);
  const library = all.filter((f) => f.library);

  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json({
    configured: true,
    folder: tree.projectFolderId,
    folders: tree.folders,
    files,
    // The shared window-brochure catalog. Empty when the folder is missing, which
    // just means the submittal slot offers the job's own files only.
    library,
    libraryFolder: brochureFolderId || null,
    // Only ever a hint for the pickers — the staffer still chooses. See doc-roles.js.
    suggested: suggestRoles(files),
  });
}
