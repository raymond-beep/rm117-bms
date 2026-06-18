// Audit the client-portal Drive mappings: for every job with a linked "Files
// Sent" folder, check whether the folder's contents actually belong to that job.
// Catches mis-maps from Drive↔app Job-ID offsets (e.g. McCalla 25_054 vs 25_055)
// and stray cross-project files.
//
//   node scripts/audit-drive-mappings.js
//
// Read-only. Flags: filenames carrying the job's client surname (good signal),
// vs. filenames carrying a DIFFERENT Job number/surname (mismatch signal).
import 'dotenv/config';
import { getDb } from '../api/_lib/db.js';
import { listFolderFiles, getFileMeta } from '../api/_lib/google-drive.js';

const NUM = /(\d{2}_\d{3})/g;
const STOP = new Set(['the', 'and', 'llc', 'inc', 'res', 'lot', 'new', 'ny', 'nj']);

// Surname from the JOB ID (same convention Drive folders are named by), so the
// folder/job comparison is apples-to-apples and not thrown off by client_name
// differences or spelling variants.
function surnameOf(job) {
  const idPart = (job.job_id || '').replace(/^\d{2}_\d{3}_(ff_|fe_)?/i, '');
  const tok = idPart.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2 && !STOP.has(t));
  return tok[0] || null;
}
const alphaOnly = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');

const db = getDb();
const { data: jobs } = await db
  .from('jobs')
  .select('job_id, client_name, drive_files_sent_folder_id')
  .not('drive_files_sent_folder_id', 'is', null)
  .not('job_id', 'like', '00_99%') // skip test jobs
  .order('job_id');

console.log(`Auditing ${jobs.length} mapped jobs…\n`);

const ok = [];
const mismatch = [];
const review = [];

const tokset = (s) => new Set((s || '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2 && !STOP.has(t)));

for (const job of jobs) {
  const jobNum = (job.job_id.match(/^(\d{2}_\d{3})/) || [])[1];
  const sn = surnameOf(job);

  // PRIMARY signal: the PROJECT folder name (parent of the "Files Sent"
  // subfolder), which is named by Job ID + client. A correct link shares the
  // surname/number; a McCalla-style offset shows a different client there.
  let projectName = null;
  try {
    const meta = await getFileMeta(job.drive_files_sent_folder_id);
    const parentId = meta?.parents?.[0];
    projectName = parentId ? (await getFileMeta(parentId))?.name || null : meta?.name || null;
  } catch (e) {
    mismatch.push({ job: job.job_id, note: `Drive error reading folder: ${e?.message || e}` });
    continue;
  }
  const folderNum = (projectName?.match(/(\d{2}_\d{3})/) || [])[1];
  // Substring match (alpha-only) tolerates "Chad_Rodriguez"/"CHADRodriguez" etc.
  const surnameInFolder = sn && alphaOnly(projectName).includes(sn);

  if (sn && !surnameInFolder) {
    mismatch.push({
      job: job.job_id,
      note: `project folder "${projectName}" — job surname "${sn}" absent${folderNum && folderNum !== jobNum ? `; folder# ${folderNum} ≠ job# ${jobNum}` : ''}`,
    });
    continue;
  }

  // Folder name looks right (or is generic) — confirm it isn't empty.
  let files;
  try { files = await listFolderFiles(job.drive_files_sent_folder_id); }
  catch (e) { mismatch.push({ job: job.job_id, note: `Drive error: ${e?.message || e}` }); continue; }
  if (files.length === 0) { review.push({ job: job.job_id, note: `project "${projectName}" — Files Sent is empty (nothing sent yet)` }); continue; }
  ok.push(job.job_id);
}

console.log(`✅ OK — folder matches the job (${ok.length})`);
console.log(`\n🔴 LIKELY MIS-MAPPED (${mismatch.length}) — folder name doesn't match the job:`);
for (const m of mismatch) console.log(`  ${m.job.padEnd(30)} ${m.note}`);
console.log(`\n🟡 EMPTY / REVIEW (${review.length}):`);
for (const r of review) console.log(`  ${r.job.padEnd(30)} ${r.note}`);
