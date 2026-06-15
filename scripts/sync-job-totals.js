// Syncs job_total from QBO invoice data and inserts missing payments for name-mismatched customers.
// Usage: node scripts/sync-job-totals.js [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = '/Users/raymondarocha/Downloads/Room 117 Architecture & Design LLC_Transaction List by Customer.csv';

// QBO customer name → Supabase job_id (safe, confirmed mappings only)
const NAME_MAP = {
  '24_030_Antunes':              '24_030_Antunes*',
  '24_064_Leffler Kathy Leffler':'24_064_Leffler',
  '24_074_Madden_Mantoloking':   '24_074_Madden_Mantoloking*',
  '24_075_DaSilva_FlorhamPark':  '24_075_DaSilva_Florham Park',
  '25_002_Odunlami_Lot2':        '25_002_Odunlami_Lot 2',
  '25_010_Malanga_HarrisonST':   '25_010_Malanga_Harrison St.',
  '25_019_Antunes_175':          '25_019_Antunes_175 E Crescent',
  '25_047_Costello_77 Tulip':    '25_047_Costello_Tulip',
  '26_001_Deuel_544':            '26_001_Deuel_544 Valley_Garage',
  '26_030_Rodriguez_1KnappAve':  '26_030_Rodriguez_1 Knapp Ave',
};

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

function parseAmount(str) {
  if (!str || !str.trim()) return 0;
  return parseFloat(str.replace(/[$,]/g, '')) || 0;
}

function parseDate(str) {
  const [m, d, y] = str.split('/');
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
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

async function main() {
  const lines = fs.readFileSync(CSV_PATH, 'utf8').split('\n');

  // Parse CSV into customer groups
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const f = parseCSVLine(line);
    const [c0, c1, c2, , , c5, , c7] = f;

    if (c0 && (c0.startsWith('Room 117') || c0.startsWith('Transaction List') || c0.startsWith('All Dates'))) continue;
    if (!c0 && c1 === 'Date') continue;
    if (c0.startsWith('Total for')) continue;

    // Customer group header
    if (c0 && !c1) {
      const rawName = c0.replace(/\s*\(deleted\)\s*/i, '').trim();
      current = { rawName, payments: [], invoices: [] };
      groups.push(current);
      continue;
    }

    // Transaction row
    if (!c0 && c1 && /\d+\/\d+\/\d+/.test(c1) && current) {
      const amount = parseAmount(c7);
      if (amount <= 0) continue;
      const date = parseDate(c1);
      const memo = c5 || '';
      if (c2 === 'Payment') current.payments.push({ date, amount, memo });
      else if (c2 === 'Invoice') current.invoices.push({ date, amount, memo });
    }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Fetch current Supabase state
  const { data: sbJobs } = await supabase.from('jobs').select('job_id, job_total');
  const sbTotals = new Map(sbJobs.map(j => [j.job_id, parseFloat(j.job_total)]));
  const validJobIds = new Set(sbJobs.map(j => j.job_id));

  const { data: existingPayments } = await supabase.from('payments').select('job_id, amount, paid_date');
  const existingSet = new Set((existingPayments || []).map(p =>
    `${p.job_id}|${parseFloat(p.amount).toFixed(2)}|${p.paid_date}`
  ));

  if (DRY_RUN) console.log('*** DRY RUN — nothing will be written ***\n');

  let totalsUpdated = 0, paymentsInserted = 0;

  for (const group of groups) {
    // Resolve job_id: exact match, then NAME_MAP, then skip
    let jobId = null;
    if (validJobIds.has(group.rawName)) {
      jobId = group.rawName;
    } else if (NAME_MAP[group.rawName] && validJobIds.has(NAME_MAP[group.rawName])) {
      jobId = NAME_MAP[group.rawName];
    } else {
      continue; // unresolvable — skip
    }

    const qboTotal = group.invoices.reduce((s, i) => s + i.amount, 0);
    const currentTotal = sbTotals.get(jobId) || 0;

    // Update job_total if QBO has a higher value (it's the source of truth)
    if (qboTotal > currentTotal) {
      if (DRY_RUN) {
        console.log(`UPDATE job_total: ${jobId} — $${currentTotal} → $${qboTotal}`);
      } else {
        const { error } = await supabase
          .from('jobs')
          .update({ job_total: qboTotal })
          .eq('job_id', jobId);
        if (error) {
          console.error(`  FAIL job_total update ${jobId}: ${error.message}`);
        } else {
          console.log(`  TOTAL UPDATED: ${jobId} $${currentTotal} → $${qboTotal}`);
          totalsUpdated++;
        }
      }
    }

    // Insert any missing payments (for name-mapped customers that were previously unmatched)
    if (NAME_MAP[group.rawName]) {
      const invoiceByAmount = new Map();
      for (const inv of group.invoices) {
        const key = inv.amount.toFixed(2);
        if (!invoiceByAmount.has(key)) invoiceByAmount.set(key, []);
        invoiceByAmount.get(key).push(inv.memo);
      }

      for (const pmt of group.payments) {
        const key = `${jobId}|${pmt.amount.toFixed(2)}|${pmt.date}`;
        if (existingSet.has(key)) continue;

        const memos = invoiceByAmount.get(pmt.amount.toFixed(2)) || [];
        const paymentType = memos.length === 1 ? normalizePaymentType(memos[0]) : 'other';

        const row = {
          job_id: jobId,
          amount: pmt.amount,
          paid_date: pmt.date,
          payment_type: paymentType,
          payment_method: 'qb',
          notes: 'Imported from QBO historical export',
        };

        if (DRY_RUN) {
          console.log(`  INSERT payment: ${jobId} $${pmt.amount} on ${pmt.date} [${paymentType}]`);
        } else {
          const { error } = await supabase.from('payments').insert(row);
          if (error) {
            console.error(`  FAIL payment ${jobId}: ${error.message}`);
          } else {
            console.log(`  PAYMENT INSERTED: ${jobId} $${pmt.amount} on ${pmt.date} [${paymentType}]`);
            paymentsInserted++;
            existingSet.add(key);
          }
        }
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Job totals updated${DRY_RUN ? ' (dry)' : ''}:    ${totalsUpdated}`);
  console.log(`Payments inserted${DRY_RUN ? ' (dry)' : ''}:     ${paymentsInserted}`);
}

main().catch(console.error);
