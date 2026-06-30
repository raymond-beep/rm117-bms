// Service-account Google Drive client for the client-portal vault. Reads the whole
// vault (portal Documents) and creates the app's own delivered files (letters /
// proposals). Reuses the Sheets-reader credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL +
// GOOGLE_PRIVATE_KEY). For reads the service account need only be a Shared Drive
// MEMBER; to deliver files it must be a Content manager (see SCOPES note below).
//
// The backend brokers every file access: clients never receive Drive
// permissions and never see Drive itself. All calls pass supportsAllDrives so
// Shared Drive (Team Drive) items resolve.
import { Readable } from 'node:stream';
import { google } from 'googleapis';

// readonly = list/read the whole vault (portal Documents); drive.file = create
// the app's own files (delivered letters/proposals). drive.file is least-privilege
// for writes — it only grants access to files this app creates, never the rest of
// the Drive. NOTE: scope alone isn't enough to upload — the service account must
// also hold a content-writer (Content manager) role on the Shared Drive; while it
// is only a Viewer member, every upload 403s. (Read paths keep working regardless.)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

let _drive = null;

export function hasDrive() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

// Normalize the service-account private key across environments. Locally dotenv
// strips the surrounding quotes from .env; Vercel does NOT, so the runtime value
// can arrive wrapped in quotes with literal "\n" — which makes OpenSSL reject it
// (error:1E08010C DECODER unsupported). Strip quotes, then unescape newlines.
function privateKey() {
  let k = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if (k.length >= 2 && (k[0] === '"' || k[0] === "'") && k[k.length - 1] === k[0]) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, '\n');
}

function drive() {
  if (_drive) return _drive;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: SCOPES,
  });
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

// List non-trashed files directly inside a folder, newest first.
// Returns [{ id, name, mimeType, size, modifiedTime }]. Folders are excluded.
export async function listFolderFiles(folderId) {
  const out = [];
  let pageToken;
  do {
    const { data } = await drive().files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Shared Drives (Team Drives) the service account is a member of.
export async function listSharedDrives() {
  const { data } = await drive().drives.list({ pageSize: 100, fields: 'drives(id, name)' });
  return data.drives || [];
}

// Immediate child folders of a parent (a Shared Drive root, or a project folder).
export async function listChildFolders(parentId) {
  const out = [];
  let pageToken;
  do {
    const { data } = await drive().files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      orderBy: 'name',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// ── Self-heal: resolve a job's "Files Sent" folder on demand ──────────────────
// New jobs created after the bulk mapper run (scripts/map-drive-folders.js) have
// a null jobs.drive_files_sent_folder_id, so their portal vault shows nothing.
// Rather than require a manual re-run, the files endpoint calls this just-in-time
// when the stored id is null: it locates the job's project folder in the Shared
// Drive (by Job ID), finds its "Files Sent" subfolder, and returns the id (the
// caller persists it). This also self-corrects the common "the Drive subfolder
// was created after the job" case, because it re-checks every time it's still null.
//
// Read-only on Drive. Returns the subfolder id, or null if the project folder or
// its "Files Sent" subfolder doesn't exist yet (a Drive-content gap, not an error).

const CLIENT_SUBFOLDER = (process.env.CLIENT_SUBFOLDER || 'Files Sent').trim().toLowerCase();
const JOBID_PREFIX = /^(\d{2}_\d{3})/; // YY_NNN project number
let _sharedDriveId = null;

// The one Shared Drive the service account brokers (cached). Honors SHARED_DRIVE_ID
// when set; otherwise auto-detects, requiring exactly one membership to stay safe.
async function resolveSharedDriveId() {
  if (_sharedDriveId) return _sharedDriveId;
  if (process.env.SHARED_DRIVE_ID) return (_sharedDriveId = process.env.SHARED_DRIVE_ID);
  const drives = await listSharedDrives();
  if (drives.length !== 1) return null; // 0 = not a member; >1 = ambiguous, don't guess
  return (_sharedDriveId = drives[0].id);
}

// Find the project folder for a job. Folders are named by Job ID (sometimes with
// an address suffix), and live at the Shared Drive root or one level inside a
// "YYYY Jobs" archive. A targeted `name contains 'YY_NNN'` search keeps this cheap
// (no full-tree walk). Picks the best match; returns null if none or ambiguous.
async function findProjectFolder(driveId, jobId) {
  const m = jobId.match(JOBID_PREFIX);
  if (!m) return null;
  const num = m[1];

  const { data } = await drive().files.list({
    q: `name contains '${num.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    corpora: 'drive',
    driveId,
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  // Only folders whose YY_NNN prefix truly equals this job's (substring guard:
  // "26_042" must not match "126_0426").
  const candidates = (data.files || []).filter((f) => f.name.match(JOBID_PREFIX)?.[1] === num);
  if (candidates.length === 0) return null;

  // Prefer an exact Job-ID name, then a folder that starts with the Job ID, then
  // — only if the number is unambiguous — the sole candidate for that YY_NNN.
  return (
    candidates.find((f) => f.name === jobId) ||
    candidates.find((f) => f.name.startsWith(jobId)) ||
    (candidates.length === 1 ? candidates[0] : null)
  );
}

// Resolve a named subfolder inside a job's project folder. `match` is a predicate
// over the lowercased subfolder name, so callers can be exact ("files sent") or
// fuzzy ("proposal"/"proposals"). Read-only; returns the folder id or null.
async function resolveSubfolderId(jobId, match) {
  if (!hasDrive() || !jobId) return null;
  const driveId = await resolveSharedDriveId();
  if (!driveId) return null;

  const project = await findProjectFolder(driveId, jobId);
  if (!project) return null;

  const subs = await listChildFolders(project.id);
  const hit = subs.find((s) => match(s.name.trim().toLowerCase()));
  return hit?.id || null;
}

// The job's client-facing "Files Sent" folder (the one the portal vault reads).
// Building-department letters are delivered here.
export function resolveFilesSentFolderId(jobId) {
  return resolveSubfolderId(jobId, (name) => name === CLIENT_SUBFOLDER);
}

// The job's "Proposal(s)" folder — where the firm files proposals (kept distinct
// from Files Sent). Matches "proposal" or "proposals" first, then any name that
// contains "proposal" as a fallback.
const PROPOSAL_SUBFOLDER = (process.env.PROPOSAL_SUBFOLDER || 'Proposal').trim().toLowerCase();
export function resolveProposalFolderId(jobId) {
  return resolveSubfolderId(
    jobId,
    (name) => name === PROPOSAL_SUBFOLDER || name === `${PROPOSAL_SUBFOLDER}s` || name.includes('proposal'),
  );
}

// ── Folder rename (for the "Correct Job ID" flow) ─────────────────────────────
// Locate a job's Drive folder for renaming. Returns { id, name, exact } where
// `exact` means the folder name equals the Job ID precisely (vs. a "<Job ID> 123
// Main St" variant). The rename step only acts on an exact match, so we never
// strip an address suffix off a folder by accident.
export async function findJobFolder(jobId) {
  if (!hasDrive() || !jobId) return null;
  const driveId = await resolveSharedDriveId();
  if (!driveId) return null;
  const f = await findProjectFolder(driveId, jobId);
  if (!f) return null;
  return { id: f.id, name: f.name, exact: f.name === jobId };
}

// Rename a Drive folder. Used to keep the job folder name === Job ID.
export async function renameFolder(folderId, newName) {
  const { data } = await drive().files.update({
    fileId: folderId,
    requestBody: { name: newName },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return data;
}

// ── New-job folder provisioning ───────────────────────────────────────────────
// Create a subfolder under a parent. Returns { id, name }. Like uploads, this
// 403s until the service account has content-writer (Content manager) access on
// the Shared Drive; drive.file then lets it manage the folders it creates.
export async function createFolder(name, parentId) {
  const { data } = await drive().files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return data;
}

// The standard subfolder set a new job folder gets (Ray, 2026-06-29). Photos is
// nested inside "Field Measure" rather than at the top level.
const JOB_SUBFOLDERS = ['Files Sent', 'Files Received', 'Proposal', 'Checksets', 'Field Measure', 'Archive'];
const NESTED_SUBFOLDERS = { 'Field Measure': ['Photos'] };

// Provision a brand-new job's Drive folder tree at the Shared Drive root:
//   <Job ID>/  Files Sent · Files Received · Proposal · Checksets · Field Measure/Photos · Archive
// Idempotent: if a folder for this Job ID already exists (by exact name or a
// "<Job ID> <address>" variant) it is reused, never duplicated. Returns
// { ok, created, folderId, filesSentId, reason? }. Best-effort by design — the
// caller treats failure as non-fatal so job creation never depends on Drive.
export async function provisionJobFolders(jobId) {
  if (!hasDrive() || !jobId) return { ok: false, reason: 'no-drive' };
  const driveId = await resolveSharedDriveId();
  if (!driveId) return { ok: false, reason: 'no-shared-drive' };

  // Reuse an existing folder for this exact Job ID (don't duplicate). Only accept
  // an exact name or a "<Job ID>…" name — not merely the same YY_NNN number.
  const found = await findProjectFolder(driveId, jobId);
  if (found && (found.name === jobId || found.name.startsWith(jobId))) {
    const filesSentId = (await listChildFolders(found.id))
      .find((s) => s.name.trim().toLowerCase() === CLIENT_SUBFOLDER)?.id || null;
    return { ok: true, created: false, folderId: found.id, filesSentId };
  }

  // Create the job folder at the Shared Drive root, then its subfolders.
  const jobFolder = await createFolder(jobId, driveId);
  const made = {};
  for (const name of JOB_SUBFOLDERS) {
    const sub = await createFolder(name, jobFolder.id);
    made[name] = sub.id;
    for (const child of NESTED_SUBFOLDERS[name] || []) {
      await createFolder(child, sub.id);
    }
  }
  return { ok: true, created: true, folderId: jobFolder.id, filesSentId: made['Files Sent'] || null };
}

// Upload bytes as a NEW file into a Drive folder (always creates; the caller picks
// a non-colliding name). Returns { id, name, webViewLink }.
// 403s until the service account has content-writer access on the Shared Drive.
export async function uploadToFolder(folderId, { name, mimeType = 'application/pdf', bytes }) {
  const { data } = await drive().files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body: Readable.from(Buffer.from(bytes)) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return data;
}

// File metadata including parents — used to verify a download request really
// belongs to the folder the client is allowed to see.
export async function getFileMeta(fileId) {
  const { data } = await drive().files.get({
    fileId,
    fields: 'id, name, mimeType, size, parents',
    supportsAllDrives: true,
  });
  return data;
}

// Stream a file's bytes (alt=media) to an HTTP response.
export async function streamFileTo(fileId, res) {
  const resp = await drive().files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    resp.data.on('end', resolve).on('error', reject).pipe(res);
  });
}
