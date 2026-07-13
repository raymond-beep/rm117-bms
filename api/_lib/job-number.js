// Promoting a LEAD to a real job — assigning its official Job ID.
//
// Ang's workflow: a lead is created as `YY_xxx_LastName` and only earns a sequential
// number when the proposal is SIGNED. That way a lead that never converts doesn't burn
// a job number (and the numbers stay a true count of won work).
//
// Promotion does three things, in this order:
//   1. pick the next free number — checking BOTH the app DB and Google Drive, because
//      jobs are still filed in Drive by hand, so the DB alone lags and would re-use a
//      number that already exists on disk;
//   2. rename the job_id (child rows follow via ON UPDATE CASCADE, migration 0007);
//   3. provision the Drive folder tree under the REAL id — a lead never gets one,
//      precisely so we never have to rename a folder.
//
// The QBO customer is NOT created here: it's created lazily on the first invoice, and
// that already keys off the (now real) Job ID.
import { isPlaceholderJobId, PLACEHOLDER_NUM } from './db.js';
import { hasDrive, provisionJobFolders, listJobNumbersForYear } from './google-drive.js';

// Split `26_xxx_FF_Smith` → { yy: '26', num: 'xxx', ff: 'FF_', name: 'Smith' }.
// Returns null when the id isn't a placeholder.
export function parsePlaceholder(jobId) {
  const m = /^(\d{2})_xxx_(FF_)?(.+)$/.exec(jobId || '');
  if (!m) return null;
  return { yy: m[1], num: PLACEHOLDER_NUM, ff: m[2] || '', name: m[3] };
}

// Highest number already used for a year across a list of ids (DB) — pure, testable.
export function maxNumberForYear(jobIds, yy) {
  let max = 0;
  for (const id of jobIds || []) {
    if (typeof id !== 'string') continue;
    const m = new RegExp(`^${yy}_(\\d{3})`).exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// Assemble the real id from a parsed placeholder + a number.
export function officialJobId({ yy, ff, name }, n) {
  return `${yy}_${String(n).padStart(3, '0')}_${ff}${name}`;
}

// Next free number for `yy`, considering the app DB AND Drive. Drive is best-effort —
// if it's unreachable we still assign from the DB rather than blocking the promotion.
export async function nextFreeNumber(db, yy) {
  const { data: rows } = await db.from('jobs').select('job_id');
  const dbMax = maxNumberForYear((rows || []).map((r) => r.job_id), yy);

  let driveMax = 0;
  if (hasDrive()) {
    try {
      const { max } = await listJobNumbersForYear(yy);
      driveMax = Number(max) || 0;
    } catch (err) {
      console.error('[job-number] Drive scan failed; falling back to the DB', err);
    }
  }
  return Math.max(dbMax, driveMax) + 1;
}

// Promote a placeholder job to its official Job ID.
// Returns { renamed: false, reason } when there's nothing to do, else
// { renamed: true, from, to, drive }.
export async function assignOfficialJobId(db, jobId) {
  const parts = parsePlaceholder(jobId);
  if (!parts) return { renamed: false, reason: 'not_a_placeholder' };

  const n = await nextFreeNumber(db, parts.yy);
  let newId = officialJobId(parts, n);

  // Paranoia: a concurrent promotion could have taken the number between our read and
  // our write. Walk forward until the id is free rather than failing the save.
  for (let i = 0; i < 25; i += 1) {
    const { data: clash } = await db.from('jobs').select('job_id').eq('job_id', newId).maybeSingle();
    if (!clash) break;
    newId = officialJobId(parts, n + i + 1);
  }

  // jobs(job_id) FKs are ON UPDATE CASCADE (migration 0007), so payments, invoices,
  // phase events, field notes… all follow this rename atomically.
  const { error } = await db.from('jobs').update({ job_id: newId }).eq('job_id', jobId);
  if (error) throw new Error(`Could not assign the job number: ${error.message}`);

  // Drive is best-effort — a folder failure must not undo a signed job's number.
  let drive = null;
  if (hasDrive()) {
    try {
      const prov = await provisionJobFolders(newId);
      if (prov?.folderId) {
        drive = { created: prov.created, folderId: prov.folderId };
        if (prov.filesSentId) {
          await db.from('jobs').update({ drive_files_sent_folder_id: prov.filesSentId }).eq('job_id', newId);
        }
      } else {
        drive = { error: prov?.reason || 'not provisioned' };
      }
    } catch (err) {
      console.error('[job-number] Drive provisioning failed', err);
      drive = { error: err.message };
    }
  }

  return { renamed: true, from: jobId, to: newId, drive };
}

export { isPlaceholderJobId };
