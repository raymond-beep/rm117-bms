// Which of a job's Drive PDFs is likely the window schedule, the REScheck, and the
// contractor's submittal. Pure (no db/network) so the guessing rules are unit-tested.
//
// This only ever SUGGESTS. A staffer picks the three documents; a wrong guess must
// cost a click, never a wrong answer — the whole feature's value is that a person
// confirms what the AI compared, so the picker cannot quietly choose for them.
//
// The rules come from what the firm's Drive actually looks like (probed 2026-07-21):
// spelling is inconsistent ("ResCheck", "Rescheck", "REScheck", "260617_ResCheck.pdf"),
// and the three inputs live in different subfolders — REScheck in Files Sent, the
// contractor's brochure in Files Received.

// Normalize away case, separators and dates so "260617_ResCheck.pdf" and
// "REScheck - 09.15.25.pdf" both reduce to something matchable.
const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.\s]+/g, ' ');

// "rescheck" survives every spelling we've seen, including a stray space/hyphen.
const RESCHECK_RE = /res\s?check/;
const SCHEDULE_RE = /schedule/;
const WINDOW_RE = /window/;
const SUBMITTAL_RE = /submittal|submital|brochure|cut\s?sheet|spec\s?sheet|quote|order/;

// The drawing set of RECORD, vs. a working copy of it. Checked against a real job
// (24_073_Dasilva, probed 2026-07-21) whose Checksets folder holds markup copies and
// prelim sets alongside the conformed permit set — the schedule must come from the
// document that was actually issued, or we'd check windows against superseded sizes.
const OF_RECORD_RE = /permit set|conformed/;
const WORKING_COPY_RE = /markup|mark\s?up|redline/;
const PRELIM_RE = /prelim|draft/;

// Window manufacturers, so a brochure named after the product — the normal case —
// is recognised without the word "submittal" anywhere in it.
const MANUFACTURER_RE =
  /andersen|pella|marvin|jeld\s?-?\s?wen|harvey|milgard|simonton|anlin|provia|therma\s?-?\s?tru|velux|kolbe|weathershield/;

// Things that arrive in Files Received but are emphatically NOT a contractor's
// product submittal. Belt-and-braces on top of the positive-signal requirement:
// it also catches a manufacturer's name on the wrong KIND of document
// ("Pella invoice.pdf" is not the thing we check windows against).
const NOT_SUBMITTAL_RE =
  /survey|plot\s?plan|invoice|proposal|contract|release|deed|title|permit application|violation|tax\s?map|denial|comments|correspondence/;

const inFolder = (file, re) => re.test(norm(file.folderName));
const RECEIVED_RE = /files received|received|submittals/;
const SENT_RE = /files sent|checksets/;

// Score a file for one role. 0 = not a candidate; higher = better guess.
// Scores are additive so a "Window Schedule.pdf" in Files Sent beats a bare
// "schedule.pdf" sitting loose in the project folder.
export function scoreForRole(file, role) {
  const name = norm(file?.name);
  if (!name) return 0;
  let score = 0;

  if (role === 'rescheck') {
    if (!RESCHECK_RE.test(name)) return 0;
    score += 10;
    if (inFolder(file, SENT_RE)) score += 2;
  } else if (role === 'schedule') {
    // The schedule is a table on our drawings, so a drawing set counts as a
    // candidate even when its filename says nothing about windows.
    if (SCHEDULE_RE.test(name)) score += 8;
    if (WINDOW_RE.test(name)) score += 4;
    const named = score > 0;
    if (!named && !inFolder(file, SENT_RE)) return 0;
    if (inFolder(file, SENT_RE)) score += 2;
    // Prefer the issued set over a working copy of it.
    if (OF_RECORD_RE.test(name)) score += 5;
    if (PRELIM_RE.test(name)) score -= 3;
    if (WORKING_COPY_RE.test(name)) score -= 6;
  } else if (role === 'submittal') {
    // Direction (it arrived in Files Received) is a BOOST, never a qualifier.
    // Checked against three real jobs: Files Received is a general inbound pile —
    // `survey.pdf`, `Client Comments_06_20_25.pdf`, `422579-Zoning_Denial.pdf` —
    // so qualifying on the folder alone suggested each of those as a window
    // brochure. A submittal has to look like one by NAME; the folder then ranks it.
    if (NOT_SUBMITTAL_RE.test(name)) return 0;
    if (SUBMITTAL_RE.test(name)) score += 6;
    if (MANUFACTURER_RE.test(name)) score += 6;
    if (score === 0) return 0;
    if (inFolder(file, RECEIVED_RE)) score += 4;
  } else {
    return 0;
  }

  // A penalty can push a weak candidate below zero; that just means "don't suggest it".
  return Math.max(0, score);
}

export const ROLES = ['schedule', 'rescheck', 'submittal'];

// Best candidate per role: { schedule: fileId|null, rescheck: …, submittal: … }.
// Ties go to the file listed first (the Drive helper returns modifiedTime desc, so
// that is the most recent — the REScheck gets revised and we want the current one).
export function suggestRoles(files = []) {
  const out = {};
  for (const role of ROLES) {
    let best = null;
    let bestScore = 0;
    for (const f of files) {
      const score = scoreForRole(f, role);
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    out[role] = best?.id || null;
  }
  return out;
}
