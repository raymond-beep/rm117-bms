// Drive → app sync: the pure half. No network, no db — feed it folder listings and
// job rows, get back the review queue. That keeps the rules that decide "is this a
// real job?" unit-testable (tests/drive-sync.test.js), which matters because a wrong
// answer here mints a bogus Job ID, and the Job ID is what QuickBooks matches on.
//
// The firm's Drive naming, as it actually is (scanned 2026-07-14, 3,607 folders):
//   26_044_Seesman                 → a numbered job
//   26_043_Goddard_104 Winslow Pl  → a numbered job, address in the suffix
//   26_046_FE_Belleville           → a numbered job; FE_ is NOT the FF_ Forefront marker
//   26_XXX_Onorato                 → a LEAD (unsigned; no number burned yet)
//   24_XXX_ 120 Saint Paul         → a lead, sloppily typed (note the space)
//   2025 Jobs · Zoning · Untitled folder · Window Specs → not jobs at all
import { JOB_ID_RE, PLACEHOLDER_NUM } from './db.js';

// A numbered project folder: YY_NNN_<rest>. `rest` may hold FF_/FE_, a name, an address.
const JOB_FOLDER = /^(\d{2})_(\d{3})_(.+)$/;
// A lead folder: YY_XXX_<rest>, in any case. This IS the app's placeholder convention —
// the firm arrived at it independently, which is the whole reason this sync is cheap.
const LEAD_FOLDER = /^(\d{2})_x{3}_(.*)$/i;

// FF_ = Forefront (the app models it as jobs.is_forefront). FE_ appears in Drive too but
// means something else the app has never modelled — so it is left VERBATIM in the name
// rather than guessed at. Getting this wrong would silently mis-file a commission.
const FF_PREFIX = /^FF_/i;

/**
 * Read one Drive folder name. Returns null when it isn't a job or lead folder at all
 * (the Shared Drive root is full of "Zoning", "Window Specs", "2025 Jobs", …).
 *
 * `jobId` is what the row would be keyed by:
 *   - a numbered job keeps the folder name VERBATIM, because the invariant is
 *     Job ID === QBO Customer Display Name === Drive folder name. Normalising it here
 *     would quietly break the three-way match.
 *   - a lead is lowercased to `YY_xxx_…` to satisfy JOB_ID_RE / isPlaceholderJobId.
 *     Its folder keeps its own name; the row remembers the folder by ID, not by name.
 */
export function parseFolderName(rawName) {
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;

  const lead = name.match(LEAD_FOLDER);
  if (lead) {
    const rest = lead[2].trim();
    if (!rest) return null; // "26_XXX_" alone names nothing
    return {
      kind: 'lead',
      jobId: `${lead[1]}_${PLACEHOLDER_NUM}_${rest}`,
      clientName: clientNameFrom(rest),
      isForefront: FF_PREFIX.test(rest),
      suggestedPhase: 'lead',
    };
  }

  const job = name.match(JOB_FOLDER);
  if (job) {
    const rest = job[3].trim();
    if (!rest) return null;
    return {
      kind: 'job',
      jobId: name, // verbatim — this is the QBO/Drive key
      clientName: clientNameFrom(rest),
      isForefront: FF_PREFIX.test(rest),
      // A number means the proposal was signed, so the job is past Lead/Proposal Sent.
      // Survey/Zoning is the first phase after signing — a starting guess the staffer
      // confirms or changes on import; it is never written behind their back.
      suggestedPhase: 'survey_zoning',
    };
  }

  return null;
}

// Best guess at the client from the folder's name part: drop the FF_/FE_ marker, then
// take the first token — "Goddard_104 Winslow Pl" → "Goddard". A guess only: the import
// leaves client_id unlinked and flags the row for review, because "Deuel" names five
// different projects and picking the wrong client record is worse than picking none.
export function clientNameFrom(rest) {
  const s = String(rest || '').replace(/^(FF|FE)_/i, '').trim();
  if (!s) return '';
  const first = s.split(/[_]/)[0].trim();
  return first || s;
}

// The YY_NNN key a folder and a job row are matched ON. Names drift between the two
// systems (Drive has `26_002_Deuel_544_Valley`, the app has `26_002_Deuel_542 Valley` —
// the addresses are genuinely swapped, and that is Ang's to resolve, not ours to
// "correct"). The NUMBER is the stable identity; the name is not.
export function jobNumberOf(jobId) {
  const m = String(jobId || '').match(/^(\d{2}_\d{3})/);
  return m ? m[1] : null;
}

/**
 * The review queue: Drive folders that are new work and aren't in the app yet.
 *
 * @param folders  [{ id, name, createdTime }] from Drive
 * @param jobs     [{ job_id }] from the app
 * @param opts.watermark      ISO string — folders created at or before it are BACKLOG
 * @param opts.dismissedIds   Drive folder ids a staffer waved off
 * @returns [{ folderId, folderName, createdTime, kind, jobId, clientName, isForefront,
 *            suggestedPhase, valid, problem }]
 */
export function buildQueue(folders = [], jobs = [], { watermark, dismissedIds = [] } = {}) {
  const dismissed = new Set(dismissedIds);
  const takenNumbers = new Set();
  const takenIds = new Set();
  for (const j of jobs) {
    takenIds.add(j.job_id);
    const n = jobNumberOf(j.job_id);
    if (n) takenNumbers.add(n);
  }
  const cutoff = watermark ? new Date(watermark).getTime() : 0;

  const queue = [];
  for (const f of folders) {
    if (dismissed.has(f.id)) continue;

    const parsed = parseFolderName(f.name);
    if (!parsed) continue; // not a job folder at all

    // The watermark: only work created since the sync went in. Everything older is the
    // 233-folder historical backlog, which must never reach the board on its own.
    const created = new Date(f.createdTime || 0).getTime();
    if (!(created > cutoff)) continue;

    // Already in the app? Numbered jobs match on the NUMBER; leads have no number, so
    // they match on the placeholder id (case-insensitively — Drive types XXX, we store xxx).
    if (parsed.kind === 'job') {
      const n = jobNumberOf(parsed.jobId);
      if (n && takenNumbers.has(n)) continue;
    } else if ([...takenIds].some((id) => id.toLowerCase() === parsed.jobId.toLowerCase())) {
      continue;
    }

    // Is the folder actually usable? Two different bars, on purpose:
    //
    //   A LEAD is forgiving. `24_XXX_ 120 Saint Paul` (a real one — note the stray space)
    //   is tidied to `24_xxx_120 Saint Paul` and imported. A lead's id never reaches
    //   QuickBooks or Drive-by-name, so cleaning it costs nothing.
    //
    //   A NUMBERED JOB is not. Its Job ID must equal the Drive folder name AND the QBO
    //   Customer Display Name, character for character. So if tidying the name CHANGED it,
    //   we must not quietly import the tidy version — that would leave the app and the
    //   folder disagreeing. Flag it and let a staffer rename the folder in Drive.
    const wellFormed = JOB_ID_RE.test(parsed.jobId);
    const nameIsExact = parsed.kind === 'lead' || parsed.jobId === String(f.name).trim();
    const valid = wellFormed && nameIsExact;

    let problem = null;
    if (!wellFormed) {
      problem = 'The folder name doesn’t fit YY_NNN_Name — rename it in Drive, then it can be added.';
    } else if (!nameIsExact) {
      problem = `The folder name has extra spaces in it. Rename it to “${parsed.jobId}” in Drive so the app, the folder, and QuickBooks all agree.`;
    }

    queue.push({
      folderId: f.id,
      folderName: f.name,
      createdTime: f.createdTime || null,
      ...parsed,
      valid,
      problem,
    });
  }

  // Newest first: the folder someone made this morning is the one they're looking for.
  return queue.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
}
