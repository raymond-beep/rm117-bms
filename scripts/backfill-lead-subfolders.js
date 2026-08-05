// One-off: fill in the standard Drive subfolder tree for leads whose folder is missing it.
//
//   node scripts/backfill-lead-subfolders.js                  # dry run — leads with no Proposal folder
//   node scripts/backfill-lead-subfolders.js --apply          # fix those
//   node scripts/backfill-lead-subfolders.js --all [--apply]  # every lead missing ANY standard folder
//
// Default scope is deliberately the reported problem — a lead with **no Proposal folder** — not
// every gap. Measured 2026-08-04: 4 leads have no Proposal folder, but all 26 are missing
// something (nearly all lack Checksets / Field Measure / Archive, which no hand-made folder has
// ever had). Creating ~100 folders across the firm's live Drive is a bigger, more visible change
// than fixing the thing Ang actually hit, so it takes an explicit `--all`.
//
// Note: fixing a lead completes its WHOLE tree, not just Proposal — that is what
// `ensureJobSubfolders` does, and it keeps a fixed folder identical to a freshly imported one.
//
// WHY (Ray + Ang, 2026-08-04): the tree used to be built only when a proposal was SIGNED
// (api/_lib/job-number.js, at promotion) — one step too late, because the proposal is
// WRITTEN before it's signed. Ang went to file a batch of proposals and found no "Proposal"
// folder to save them into. Measured that day: 4 of 26 live leads had none, and two of them
// (Tambakuwala, Teggart) had their proposal .docx + .pdf sitting loose at the folder root
// because there was nowhere else to put them.
//
// api/drive/import.js now does this at IMPORT for every new folder, so this script is only
// for the leads already in the app. It is safe to re-run: `ensureJobSubfolders` matches
// case-insensitively and creates only what's absent.
//
// Scope guards, deliberately narrow:
//  - Leads/proposals-sent only (`lead`, `potential`), and only rows that already carry a
//    `drive_folder_id` — this NEVER creates a top-level folder, so the invariant that a
//    `YY_xxx_` placeholder Job ID never reaches Drive-by-name still holds.
//  - Nothing already in a folder is read, moved, renamed or deleted. Additive only.
//
// ⚠️ Known wart it does NOT fix: `26_xxx_FF_Mandal` has a misspelt "Files Recevied" folder.
// This will create a correctly-spelt "Files Received" NEXT TO it rather than renaming it —
// moving a person's files between folders is not this script's call. Flag it for a human.
import 'dotenv/config';
import { getDb, hasDb } from '../api/_lib/db.js';
import { hasDrive, listChildFolders, ensureJobSubfolders } from '../api/_lib/google-drive.js';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

// Mirrors JOB_SUBFOLDERS / NESTED_SUBFOLDERS in api/_lib/google-drive.js — used only to
// PREVIEW what the dry run would create. The apply path calls the real function.
const EXPECTED = ['Files Sent', 'Files Received', 'Proposal', 'Checksets', 'Field Measure', 'Archive'];

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

async function main() {
  if (!hasDb()) fail('No database configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  if (!hasDrive()) fail('No Drive configured (Google service-account creds).');

  const db = getDb();
  const { data: leads, error } = await db
    .from('jobs')
    .select('job_id, phase, drive_folder_id')
    .in('phase', ['lead', 'potential'])
    .not('drive_folder_id', 'is', null)
    .order('job_id');
  if (error) fail(error.message);

  console.log(`${leads.length} lead/proposal-sent job(s) with a Drive folder.\n`);

  const plan = [];
  const skipped = [];
  for (const lead of leads) {
    let existing;
    try {
      existing = await listChildFolders(lead.drive_folder_id);
    } catch (e) {
      console.log(`  ⚠ ${lead.job_id} — could not read its folder: ${e.message}`);
      continue;
    }
    const have = new Set(existing.map((f) => f.name.trim().toLowerCase()));
    const missing = EXPECTED.filter((n) => !have.has(n.toLowerCase()));
    if (!missing.length) continue;
    // Default scope: only the leads with nowhere to file a proposal.
    if (!ALL && !missing.includes('Proposal')) {
      skipped.push({ job_id: lead.job_id, missing });
      continue;
    }
    plan.push({ ...lead, missing });
  }

  if (!plan.length) {
    console.log('✓ Nothing in scope needs fixing.');
    if (skipped.length) console.log(`  (${skipped.length} lead(s) missing other folders — re-run with --all to see them.)`);
    return;
  }

  console.log(`${plan.length} folder(s) to fix:\n`);
  for (const p of plan) {
    const flag = p.missing.includes('Proposal') ? ' ← no Proposal folder' : '';
    console.log(`  ${p.job_id}${flag}`);
    console.log(`    would create: ${p.missing.join(' · ')}`);
  }

  if (skipped.length) {
    console.log(`\n${skipped.length} other lead(s) have a Proposal folder but are missing other`);
    console.log('standard folders (mostly Checksets · Field Measure · Archive). Not in scope —');
    console.log('re-run with --all to include them.');
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to create these.');
    return;
  }

  console.log('\nApplying…\n');
  for (const p of plan) {
    try {
      const { created, filesSentId } = await ensureJobSubfolders(p.drive_folder_id);
      // Persist the portal's file-vault id if this is the first time it's existed.
      if (filesSentId) {
        await db.from('jobs')
          .update({ drive_files_sent_folder_id: filesSentId })
          .eq('job_id', p.job_id);
      }
      console.log(`  ✓ ${p.job_id} — created: ${created.length ? created.join(' · ') : '(nothing missing)'}`);
    } catch (e) {
      console.log(`  ✗ ${p.job_id} — ${e.message}`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => fail(e.message));
