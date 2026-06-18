// Map each project's "Files Sent" Drive subfolder to its job, for the client
// portal document vault. Walks the Shared Drive: top-level folders are named by
// Job ID; inside each is a "Files Sent" subfolder whose ID we store on the job
// (jobs.drive_files_sent_folder_id).
//
//   node scripts/map-drive-folders.js            # dry run — prints the plan
//   node scripts/map-drive-folders.js --apply    # write the folder IDs
//
// Optional env: SHARED_DRIVE_ID (skip auto-detect), CLIENT_SUBFOLDER (default
// "Files Sent"). Read-only on Drive; the only writes are to Supabase, and only
// with --apply.
import 'dotenv/config';
import { getDb, hasDb } from '../api/_lib/db.js';
import { hasDrive, listSharedDrives, listChildFolders } from '../api/_lib/google-drive.js';

const APPLY = process.argv.includes('--apply');
const SUBFOLDER = (process.env.CLIENT_SUBFOLDER || 'Files Sent').trim().toLowerCase();
const JOBID_PREFIX = /^(\d{2}_\d{3})/; // YY_NNN project number

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

async function main() {
  if (!hasDb()) fail('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  if (!hasDrive()) fail('Google service account not configured.');
  const db = getDb();

  // Jobs, indexed by exact id and by YY_NNN project number.
  const { data: jobs, error } = await db.from('jobs').select('job_id, drive_files_sent_folder_id');
  if (error) fail(`jobs query failed: ${error.message}`);
  const jobIds = new Set(jobs.map((j) => j.job_id));
  const byNum = new Map();
  for (const j of jobs) {
    const m = j.job_id.match(JOBID_PREFIX);
    if (!m) continue;
    if (!byNum.has(m[1])) byNum.set(m[1], []);
    byNum.get(m[1]).push(j.job_id);
  }

  // Locate the Shared Drive.
  let driveId = process.env.SHARED_DRIVE_ID;
  if (!driveId) {
    const drives = await listSharedDrives();
    if (drives.length === 0) fail('Service account is not a member of any Shared Drive.');
    if (drives.length > 1) {
      console.log('Multiple Shared Drives found — set SHARED_DRIVE_ID to choose one:');
      drives.forEach((d) => console.log(`   ${d.id}  ${d.name}`));
      fail('Ambiguous Shared Drive.');
    }
    driveId = drives[0].id;
    console.log(`Shared Drive: ${drives[0].name} (${driveId})\n`);
  }

  // Project folders live at the Shared Drive root AND inside "YYYY Jobs" archive
  // folders. Descend one level into any archive folder to catch older projects.
  const ARCHIVE = /^\d{4}\s+jobs$/i;
  const topLevel = await listChildFolders(driveId);
  const projectFolders = [...topLevel];
  for (const pf of topLevel) {
    if (ARCHIVE.test(pf.name.trim())) {
      const kids = await listChildFolders(pf.id);
      projectFolders.push(...kids);
      console.log(`  ↳ archive "${pf.name}" → ${kids.length} folders`);
    }
  }
  console.log(`\nScanning ${projectFolders.length} project folders. Subfolder target: "${process.env.CLIENT_SUBFOLDER || 'Files Sent'}"\n`);

  const matched = [];
  const skipped = [];
  for (const pf of projectFolders) {
    const m = pf.name.match(JOBID_PREFIX);
    if (!m) { skipped.push([pf.name, 'no Job ID in folder name']); continue; }

    let jobId = jobIds.has(pf.name) ? pf.name : null;
    if (!jobId) {
      const cands = byNum.get(m[1]) || [];
      if (cands.length === 1) jobId = cands[0];
      else if (cands.length > 1) { skipped.push([pf.name, `ambiguous → ${cands.join(', ')}`]); continue; }
    }
    if (!jobId) { skipped.push([pf.name, `no job for ${m[1]}`]); continue; }

    const subs = await listChildFolders(pf.id);
    const fs = subs.find((s) => s.name.trim().toLowerCase() === SUBFOLDER);
    if (!fs) { skipped.push([pf.name, `no "${process.env.CLIENT_SUBFOLDER || 'Files Sent'}" subfolder`]); continue; }

    matched.push({ jobId, folderName: pf.name, folderId: fs.id, was: jobs.find((j) => j.job_id === jobId)?.drive_files_sent_folder_id });
  }

  console.log(`── MATCHED (${matched.length}) ──`);
  for (const r of matched) {
    const flag = r.was && r.was !== r.folderId ? ' (changed)' : r.was === r.folderId ? ' (unchanged)' : '';
    console.log(`  ${r.jobId.padEnd(28)} → ${r.folderId}${flag}`);
  }
  console.log(`\n── SKIPPED (${skipped.length}) ──`);
  for (const [name, why] of skipped) console.log(`  ${name.padEnd(28)} — ${why}`);

  const toWrite = matched.filter((r) => r.was !== r.folderId);
  console.log(`\n${matched.length} matched, ${toWrite.length} need writing, ${skipped.length} skipped.`);

  if (!APPLY) {
    console.log('\nDry run — no changes written. Re-run with --apply to save.');
    return;
  }

  let ok = 0;
  for (const r of toWrite) {
    const { error: upErr } = await db.from('jobs').update({ drive_files_sent_folder_id: r.folderId }).eq('job_id', r.jobId);
    if (upErr) console.error(`  ✗ ${r.jobId}: ${upErr.message}`);
    else ok++;
  }
  console.log(`\n✓ Wrote ${ok}/${toWrite.length} folder IDs.`);
}

main().catch((e) => fail(e?.message || String(e)));
