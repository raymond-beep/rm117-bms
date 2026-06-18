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

function drive() {
  if (_drive) return _drive;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
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
