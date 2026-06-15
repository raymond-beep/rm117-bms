// One-time import of historical QBO payments from Transaction List by Customer CSV
// Usage: node scripts/import-payments.js [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = process.argv.find(a => a.endsWith('.csv'))
  || '/Users/raymondarocha/Downloads/Room 117 Architecture & Design LLC_Transaction List by Customer.csv';

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else { current += ch; }
  }
  fields.push(current);
  return fields;
}

function normalizePaymentType(raw = '') {
  const t = String(raw).toLowerCase().replace(/[\s\-_']+/g, '');
  if (t.includes('retainer')) return 'retainer';
  if (t.includes('dp1') || t.includes('deposit1')) return 'dp1';
  if (t.includes('dp2') || t.includes('deposit2')) return 'dp2';
  if (t.includes('dp3') || t.includes('deposit3')) return 'dp3';
  if (t.includes('cd') || t.includes('construction') || t.includes('permit')) return 'cd';
  if (t.includes('final') || t.includes('balance')) return 'final';
  return 'other';
}

function parseDate(str) {
  const [m, d, y] = str.split('/');
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function parseAmount(str) {
  if (!str || !str.trim()) return 0;
  return parseFloat(str.replace(/[$,]/g, '')) || 0;
}

async function main() {
  const lines = fs.readFileSync(CSV_PATH, 'utf8').split('\n');

  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const f = parseCSVLine(line);
    const [c0, c1, c2, , , c5, , c7] = f;

    // Skip report header rows
    if (c0 && (c0.startsWith('Room 117') || c0.startsWith('Transaction List') || c0.startsWith('All Dates'))) continue;
    if (!c0 && c1 === 'Date') continue; // column header row

    // Total row — skip
    if (c0.startsWith('Total for')) continue;

    // Customer group header: c0 has name, c1 is empty
    if (c0 && !c1) {
      const name = c0.replace(/\s*\(deleted\)\s*/i, '').trim();
      current = { name, payments: [], invoices: [] };
      groups.push(current);
      continue;
    }

    // Transaction row: c0 empty, c1 has date
    if (!c0 && c1 && /\d+\/\d+\/\d+/.test(c1) && current) {
      const amount = parseAmount(c7);
      if (amount <= 0) continue; // skip zero-amount system entries

      const date = parseDate(c1);
      const memo = c5 || '';

      if (c2 === 'Payment') {
        current.payments.push({ date, amount, memo });
      } else if (c2 === 'Invoice') {
        current.invoices.push({ amount, memo });
      }
    }
  }

  // Build payment rows, inferring payment_type from invoice memo when amount uniquely matches
  const toInsert = [];

  for (const group of groups) {
    // amount → [memos] from invoices in this group
    const invoiceByAmount = new Map();
    for (const inv of group.invoices) {
      const key = inv.amount.toFixed(2);
      if (!invoiceByAmount.has(key)) invoiceByAmount.set(key, []);
      invoiceByAmount.get(key).push(inv.memo);
    }

    for (const pmt of group.payments) {
      const key = pmt.amount.toFixed(2);
      const memos = invoiceByAmount.get(key) || [];
      const paymentType = memos.length === 1 ? normalizePaymentType(memos[0]) : 'other';

      toInsert.push({
        job_id: group.name,
        amount: pmt.amount,
        paid_date: pmt.date,
        payment_type: paymentType,
        payment_method: 'qb',
        notes: 'Imported from QBO historical export',
      });
    }
  }

  console.log(`\nParsed ${toInsert.length} payments across ${groups.length} customers`);
  if (DRY_RUN) console.log('*** DRY RUN — nothing will be written ***\n');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Fetch valid job IDs
  const { data: jobs, error: jobErr } = await supabase.from('jobs').select('job_id');
  if (jobErr) { console.error('Failed to fetch jobs:', jobErr.message); process.exit(1); }
  const validJobIds = new Set(jobs.map(j => j.job_id));

  // Fetch existing payments to deduplicate
  const { data: existing } = await supabase.from('payments').select('job_id, amount, paid_date');
  const existingSet = new Set((existing || []).map(p =>
    `${p.job_id}|${parseFloat(p.amount).toFixed(2)}|${p.paid_date}`
  ));

  let inserted = 0, skippedNoJob = 0, skippedDupe = 0, failed = 0;
  const unmatched = new Set();

  for (const row of toInsert) {
    if (!validJobIds.has(row.job_id)) {
      unmatched.add(row.job_id);
      skippedNoJob++;
      continue;
    }

    const key = `${row.job_id}|${row.amount.toFixed(2)}|${row.paid_date}`;
    if (existingSet.has(key)) {
      skippedDupe++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  WOULD INSERT: ${row.job_id} | $${row.amount} | ${row.paid_date} | ${row.payment_type}`);
      inserted++;
      continue;
    }

    const { error } = await supabase.from('payments').insert(row);
    if (error) {
      console.error(`  FAIL: ${row.job_id} — ${error.message}`);
      failed++;
    } else {
      console.log(`  OK: ${row.job_id} $${row.amount} on ${row.paid_date} [${row.payment_type}]`);
      inserted++;
      existingSet.add(key); // prevent same-run dupes
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Parsed:            ${toInsert.length}`);
  console.log(`Inserted${DRY_RUN ? ' (dry)' : ''}:       ${inserted}`);
  console.log(`Skipped (no job):  ${skippedNoJob}`);
  console.log(`Skipped (dupe):    ${skippedDupe}`);
  if (failed > 0) console.log(`Failed:            ${failed}`);

  if (unmatched.size > 0) {
    console.log('\nCustomers in QBO not matched to any Supabase job (review manually):');
    [...unmatched].sort().forEach(n => console.log(`  - ${n}`));
  }
}

main().catch(console.error);
