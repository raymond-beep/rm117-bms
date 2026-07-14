// "Where is this job's Drive folder?" — the one place that answers it.
//
// There are two ways to know, and the order matters:
//
//   1. `jobs.drive_folder_id` — the folder the job REMEMBERS. Set when a job is imported
//      from Drive, or provisioned by the app. Exact, and one API call cheaper.
//   2. Searching Drive for a folder NAMED after the Job ID — the original way, and the
//      only one available for jobs that predate `drive_folder_id`.
//
// ⚠️ Path 2 CANNOT WORK FOR A LEAD. It matches on the `YY_NNN` number (see findProjectFolder),
// and a lead's id is `26_xxx_FF_Corrigan` — no number. So every by-name lookup for a lead
// returns null, and the caller reports "no proposal on file" for a job whose proposal is
// sitting in Drive right now. That is exactly what happened to the leads imported from Drive:
// they HAVE folders, often with a proposal already in them.
//
// Self-healing: when path 2 does find a folder, we write the id back, so each job pays the
// search cost at most once and every later read is exact.
import { hasDrive, findJobFolder } from './google-drive.js';

export async function projectFolderIdFor(db, jobId) {
  if (!hasDrive() || !jobId) return null;

  const { data: job } = await db
    .from('jobs').select('drive_folder_id').eq('job_id', jobId).maybeSingle();
  if (job?.drive_folder_id) return job.drive_folder_id;

  // No remembered folder — fall back to the name search. Returns null for a lead, which is
  // correct: a lead with no remembered folder genuinely has no folder the app can find.
  const found = await findJobFolder(jobId);
  if (!found?.id) return null;

  // Remember it (best-effort — a failed write must not fail the read).
  db.from('jobs').update({ drive_folder_id: found.id }).eq('job_id', jobId).then(
    () => {},
    (err) => console.error('[job-folder] could not cache drive_folder_id', err),
  );

  return found.id;
}
