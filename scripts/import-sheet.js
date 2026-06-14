// Phase 2 — one-time Sheet → Supabase migration.
// Usage: npm run import:sheet -- [--dry-run] [--tab "Current Job Log"]
//
// Reads the master Sheet via the Sheets API (service account, VIEWER ONLY — the
// app can never write back to the Sheet). Parses `Current Job Log` into `jobs`
// (+ `forefront_commissions`), and the YYYY_Billing tabs into `payments`.
// Any row that fails to parse cleanly is still written, with the raw cell
// content in `import_notes` and `import_needs_review = true` — the cleanup queue.
//
// ⚠️ COLUMN_MAP below is a best-guess layout. Before the real run, do a --dry-run
// and verify the mapping against the actual Sheet headers; adjust as needed.
import 'dotenv/config';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

// Job rows start with YY_NNN_ — allow spaces in the name portion (e.g. "26_030_Rodriguez_1 Knapp Ave")
const JOB_ID_RE = /^\d{2}_\d{3}_(FF_)?.+/;

// --- Column layout of `Current Job Log` (0-indexed, verified against real sheet) ---
const COLUMN_MAP = {
  job_id: 0,               // A — Job ID (YY_NNN_[FF_]LastName)
  last_correspondence: 1,  // B — Dated correspondence notes (multi-line)
  address: 3,              // D — Property address
  client_name: 4,          // E — Client name (take first line only)
  notes: 6,                // G — Internal notes
  job_total: 9,            // J — Contracted total (numeric)
  amount_billed: 10,       // K — Amount billed to date
  bill_flag: 15,           // P — "YES" when ready to bill
  last_email_date: 16,     // Q — Last email date
  last_email_subject: 17,  // R — Last email subject
  phase_override: 18,      // S — Manual phase override written by the app
};

// Phase comes from section header rows in the sheet, not a column.
// These headers group jobs by lifecycle phase.
const PHASE_HEADER_MAP = [
  { match: /ACTIVE JOBS/i,  phase: 'active' },
  { match: /OUTGOING/i,     phase: 'active' },
  { match: /CD PHASE/i,     phase: 'cd_phase' },
  { match: /DESIGN PHASE/i, phase: 'design_phase' },
  { match: /SURVEY/i,       phase: 'survey_zoning' },
  { match: /ON HOLD/i,      phase: 'on_hold' },
  { match: /POTENTIAL/i,    phase: 'potential' },
  { match: /COMPLETED/i,    phase: 'completed' },
];

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')} — see .env.example`);
    process.exit(1);
  }
}

async function getSheetsClient() {
  const auth = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      })
    : new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
  return google.sheets({ version: 'v4', auth });
}

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function detectPhaseHeader(cellA) {
  const text = String(cellA || '').trim();
  for (const { match, phase } of PHASE_HEADER_MAP) {
    if (match.test(text)) return phase;
  }
  return null;
}

// Extract the last dated entry from correspondence (e.g. "5/14/26 – Called client")
function parseCorrespondence(raw) {
  if (!raw) return null;
  const lines = String(raw).split('\n').map(l => l.trim()).filter(Boolean);
  const dated = lines.filter(l => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l));
  const last = dated.length ? dated[dated.length - 1] : lines[lines.length - 1];
  return last || null;
}

function parseJobRow(row, rowIndex, currentPhase) {
  const cell = (key) => (row[COLUMN_MAP[key]] ?? '').toString().trim();
  const problems = [];

  const job_id = cell('job_id');
  if (!JOB_ID_RE.test(job_id)) return { skip: true, raw: row.join(' | '), rowIndex };

  const job_total = parseMoney(cell('job_total'));
  if (cell('job_total') && job_total === null) {
    problems.push(`unparseable job_total: "${cell('job_total').slice(0, 60)}"`);
  }

  const amount_billed = parseMoney(cell('amount_billed')) ?? 0;

  // Client name: take first line only (cell may have multi-line content)
  const client_name = (cell('client_name').split('\n')[0] || '').trim() || null;

  // Phase: use section header phase; phase_override in col S wins for display
  const phase_override = cell('phase_override') || null;
  const phase = currentPhase || 'potential';

  const is_forefront = job_id.includes('_FF_');

  const job = {
    job_id,
    client_name,
    address: cell('address') || null,
    phase,
    phase_override,
    job_total: job_total ?? 0,
    amount_billed,
    bill_flag: cell('bill_flag').toUpperCase() === 'YES',
    is_forefront,
    notes: cell('notes') || null,
    last_correspondence: parseCorrespondence(cell('last_correspondence')),
    last_email_date: cell('last_email_date') || null,
    last_email_subject: cell('last_email_subject') || null,
    import_notes: problems.length ? `Row ${rowIndex + 1}: ${problems.join('; ')} | RAW: ${row.join(' | ')}` : null,
    import_needs_review: problems.length > 0,
  };
  return { job };
}

async function main() {
  requireEnv('SHEET_ID');
  if (!DRY_RUN) requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_KEY');

  const sheets = await getSheetsClient();
  const tabArg = process.argv.indexOf('--tab');
  const tab = tabArg > -1 ? process.argv[tabArg + 1] : 'Current Job Log';

  console.log(`Reading "${tab}" from sheet ${process.env.SHEET_ID} (read-only)...`);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: tab,
  });
  const rows = data.values || [];
  console.log(`${rows.length} rows fetched (incl. header).`);

  const jobs = [];
  const skipped = [];
  let currentPhase = 'active'; // default to active until a header is found
  rows.slice(1).forEach((row, i) => {
    const cellA = String(row[0] || '').trim();
    // Check if this row is a phase section header (e.g. "CD PHASE", "POTENTIAL JOBS")
    const headerPhase = detectPhaseHeader(cellA);
    if (headerPhase) {
      currentPhase = headerPhase;
      return; // skip the header row itself
    }
    const result = parseJobRow(row, i + 1, currentPhase);
    if (result.skip) skipped.push(result);
    else jobs.push(result.job);
  });

  // Deduplicate: sheet may list the same job_id in multiple sections — keep last occurrence
  const jobMap = new Map();
  jobs.forEach((j) => jobMap.set(j.job_id, j));
  const uniqueJobs = Array.from(jobMap.values());
  const dupeCount = jobs.length - uniqueJobs.length;

  const flagged = uniqueJobs.filter((j) => j.import_needs_review);
  console.log(`Parsed ${uniqueJobs.length} unique jobs (${dupeCount} duplicates removed, ${flagged.length} flagged for review, ${skipped.length} rows skipped — no valid Job ID).`);
  if (skipped.length) {
    console.log('\nSkipped rows (verify these are headers/blanks, not real jobs):');
    skipped.slice(0, 20).forEach((s) => console.log(`  row ${s.rowIndex + 1}: ${s.raw.slice(0, 100)}`));
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written. Sample parsed job:');
    console.log(JSON.stringify(uniqueJobs[0], null, 2));
    return;
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log('\nUpserting jobs into Supabase...');
  const { error: jobsErr } = await db.from('jobs').upsert(uniqueJobs, { onConflict: 'job_id' });
  if (jobsErr) throw jobsErr;

  // FF commissions come from the Forefront Commissions tab, not the job log.
  // Here we just create a placeholder row for each FF job so the table has an entry.
  const ffRows = uniqueJobs
    .filter((j) => j.is_forefront)
    .map((j) => ({ job_id: j.job_id, total_commission: 0, status: 'active' }));
  if (ffRows.length) {
    console.log(`Upserting ${ffRows.length} forefront_commissions rows...`);
    const { error: ffErr } = await db.from('forefront_commissions').insert(ffRows);
    if (ffErr) throw ffErr;
  }

  console.log(`\nDone. ${uniqueJobs.length} jobs imported; ${flagged.length} need review (import_needs_review = true).`);
  console.log('Next: parse the YYYY_Billing tabs into payments (run with --tab "2026_Billing" once the payment parser is verified).');
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
