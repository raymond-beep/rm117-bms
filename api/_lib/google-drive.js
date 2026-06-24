// Service-account Google Drive client (read-only) for the client-portal vault.
// Reuses the same credentials as the Sheets reader (GOOGLE_SERVICE_ACCOUNT_EMAIL
// + GOOGLE_PRIVATE_KEY), just with the drive.readonly scope added. The service
// account must be a MEMBER (Viewer) of the firm's Shared Drive.
//
// The backend brokers every file access: clients never receive Drive
// permissions and never see Drive itself. All calls pass supportsAllDrives so
// Shared Drive (Team Drive) items resolve.
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

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

export async function resolveFilesSentFolderId(jobId) {
  if (!hasDrive() || !jobId) return null;
  const driveId = await resolveSharedDriveId();
  if (!driveId) return null;

  const project = await findProjectFolder(driveId, jobId);
  if (!project) return null;

  const subs = await listChildFolders(project.id);
  const fs = subs.find((s) => s.name.trim().toLowerCase() === CLIENT_SUBFOLDER);
  return fs?.id || null;
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
