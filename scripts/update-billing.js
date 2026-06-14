// Phase 2 — pull job_total and ff_commission from billing tabs into Supabase.
// Usage: npm run update:billing [-- --dry-run]
//
// Reads Invoice Amount (col F) and Commissions (col G) from each billing tab,
// then updates jobs.job_total and forefront_commissions.total_commission.
// Safe to re-run: uses UPDATE not INSERT, so no duplicates.
import 'dotenv/config';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

// All billing tabs to read, most recent first (earlier tabs fill in any gaps)
const TABS = [
  '2026_Billing and Finances',
  '2025_Billing and Finances',
  '2024_Billing and Finances',
  '2023_Billing and Finances',
];

// Column indices (0-based), verified against real sheet
const COL = {
  job_id:        0, // A — Job Name (matches job_id format YY_NNN_...)
  job_total:     5, // F — Invoice Amount (contracted total)
  ff_commission: 6, // G — Commissions (Forefront commission owed)
};

// Skip rows that are section headers, totals, or blank
const SKIP_RE = /^(first|second|third|fourth|q[1-4]|quarter|total|noe ave|melrose)/i;

function isJobRow(cellA) {
  return /^\d{2}_/.test(String(cellA || '').trim());
}

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function main() {
  if (!process.env.SHEET_ID) {
    console.error('Missing SHEET_ID in .env'); process.exit(1);
  }
  if (!DRY_RUN && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)) {
    console.error('Missing Supabase env vars in .env'); process.exit(1);
  }

  const sheets = await getSheetsClient();
  const db = DRY_RUN ? null : createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  // Collect updates across all tabs — most recent tab read last so it wins on conflict
  const updates = new Map(); // job_id → { job_total, ff_commission }

  for (const tab of [...TABS].reverse()) {
    let rows;
    try {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: `'${tab}'!A:J`,
      });
      rows = data.values || [];
      console.log(`${tab}: ${rows.length} rows`);
    } catch {
      console.log(`${tab}: not found — skipping`);
      continue;
    }

    rows.forEach((row) => {
      const cellA = String(row[COL.job_id] || '').trim();
      if (!isJobRow(cellA) || SKIP_RE.test(cellA)) return;

      const job_total     = parseMoney(row[COL.job_total]);
      const ff_commission = parseMoney(row[COL.ff_commission]);
      if (job_total === null && ff_commission === null) return;

      const prev = updates.get(cellA) || {};
      updates.set(cellA, {
        job_total:     job_total     ?? prev.job_total     ?? null,
        ff_commission: ff_commission ?? prev.ff_commission ?? null,
      });
    });
  }

  console.log(`\nFound financial data for ${updates.size} jobs across billing tabs.`);

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written. Preview (first 20):');
    let count = 0;
    for (const [job_id, { job_total, ff_commission }] of updates) {
      if (count++ >= 20) { console.log('  ...'); break; }
      const total = job_total     != null ? `$${job_total.toLocaleString()}` : '—';
      const ff    = ff_commission != null ? `FF $${ff_commission.toLocaleString()}` : '';
      console.log(`  ${job_id}: ${total}  ${ff}`);
    }
    return;
  }

  let jobsUpdated = 0, ffUpdated = 0;
  const notFound = [];

  for (const [job_id, { job_total, ff_commission }] of updates) {
    // Update job_total on the jobs table
    if (job_total !== null) {
      const { data, error } = await db
        .from('jobs')
        .update({ job_total })
        .eq('job_id', job_id)
        .select('job_id');

      if (error) {
        console.error(`  ${job_id}: error — ${error.message}`);
      } else if (!data || data.length === 0) {
        notFound.push(job_id);
      } else {
        jobsUpdated++;
      }
    }

    // Update total_commission on forefront_commissions
    if (ff_commission !== null) {
      const { error } = await db
        .from('forefront_commissions')
        .update({ total_commission: ff_commission })
        .eq('job_id', job_id);
      if (!error) ffUpdated++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  ${jobsUpdated} jobs updated with real job_total`);
  console.log(`  ${ffUpdated} forefront_commissions updated`);
  if (notFound.length) {
    console.log(`\n  ${notFound.length} job IDs in billing tab not found in Supabase:`);
    notFound.forEach((id) => console.log(`    ${id}`));
  }
  console.log('\nNext: refresh the app — totals and outstanding will now show real numbers.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
