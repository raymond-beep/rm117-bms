// One-time import of clients from a QBO "Customer Contact List" CSV export.
// Populates the `clients` table (name/email/phone/address) and links jobs to
// their client via jobs.client_id (QBO Customer Display Name == Job ID).
//
// Usage: node scripts/import-clients.js [--dry-run] [path/to.csv]
//
// Model: one client per unique email (repeat clients span multiple jobs).
// Rows without an email get their own client row keyed by the QBO customer name.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = process.argv.find((a) => a.endsWith('.csv'))
  || '/Users/raymondarocha/Downloads/Room 117 Architecture & Design LLC_Customer Contact List.csv';

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

// "Phone:(201) 456-2760 " + stray unicode -> "(201) 456-2760"
function cleanPhone(raw = '') {
  return raw
    .replace(/phone:/i, '')
    .replace(/[^\d()+\-.\s]/g, '') // drop non-ASCII directional marks etc.
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function cleanEmail(raw = '') {
  const e = raw.trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

// "23_045_Malanga_Z Domenick  Malanga" -> "Domenick Malanga".
// Drops leading tokens that carry digits/underscores (the job-id prefix),
// collapses whitespace. Requires >= 2 alpha tokens to be a real person name;
// otherwise returns null so the caller falls back to the QBO customer name.
function cleanName(fullName = '') {
  const toks = fullName.split(/\s+/).filter(Boolean);
  while (toks.length && /[\d_]/.test(toks[0])) toks.shift();
  const name = toks.join(' ').trim();
  const alphaToks = toks.filter((t) => /[a-z]/i.test(t));
  return alphaToks.length >= 2 ? name : null;
}

async function main() {
  const lines = fs.readFileSync(CSV_PATH, 'utf8').split('\n');

  let started = false;
  const rows = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const f = parseCSVLine(line);
    const c0 = (f[0] || '').trim();
    // Begin after the column-header row; skip report title / blank rows.
    if (!started) { if (c0 === 'Customer full name') started = true; continue; }
    if (!c0) continue;
    if (/^"?\s*\w+day,/.test(c0)) continue; // footer timestamp row
    rows.push({
      customer: c0,
      phone: cleanPhone(f[1]),
      email: cleanEmail(f[2]),
      fullName: (f[3] || '').trim(),
      address: (f[4] || '').trim() || null,
    });
  }

  // Build clients: one per email; emailless rows keyed by customer name.
  const byKey = new Map();
  for (const r of rows) {
    const key = r.email || `noemail::${r.customer}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        email: r.email,
        name: cleanName(r.fullName) || r.customer,
        nameIsFallback: !cleanName(r.fullName),
        phone: r.phone,
        address: r.address,
        jobCandidates: new Set(),
      });
    }
    const c = byKey.get(key);
    c.jobCandidates.add(r.customer);
    // Prefer a real person name / a real phone / an address if this row has one.
    if (c.nameIsFallback && cleanName(r.fullName)) {
      c.name = cleanName(r.fullName); c.nameIsFallback = false;
    }
    if (!c.phone && r.phone) c.phone = r.phone;
    if (!c.address && r.address) c.address = r.address;
  }
  const clients = [...byKey.values()];

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Valid job ids for linking.
  const { data: jobs, error: jobErr } = await supabase.from('jobs').select('job_id, client_id');
  if (jobErr) { console.error('Failed to fetch jobs:', jobErr.message); process.exit(1); }
  const validJobIds = new Set(jobs.map((j) => j.job_id));

  // Normalized index for safe near-miss linking: lowercase, drop everything
  // except letters/digits. This collapses "Lot2"/"Lot 2", trailing "*",
  // "1KnappAve"/"1 Knapp Ave" — but keeps the YY_NNN job number significant,
  // so 25_052 vs 25_053 will NOT collide. Only used when the normalized key
  // maps to exactly ONE job (ambiguous keys are skipped).
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normIndex = new Map();
  for (const id of validJobIds) {
    const k = norm(id);
    if (!normIndex.has(k)) normIndex.set(k, new Set());
    normIndex.get(k).add(id);
  }
  // Resolve a QBO customer name to a job_id: exact first, then unique-normalized.
  const fuzzyLinks = []; // [{ customer, job_id }] for the review output
  function resolveJob(customer) {
    if (validJobIds.has(customer)) return customer;
    const hits = normIndex.get(norm(customer));
    if (hits && hits.size === 1) {
      const id = [...hits][0];
      fuzzyLinks.push({ customer, job_id: id });
      return id;
    }
    return null;
  }

  // Existing clients (dedupe on re-run).
  const { data: existing } = await supabase.from('clients').select('id, email, name');
  const existingByEmail = new Map((existing || []).filter((c) => c.email).map((c) => [c.email.toLowerCase(), c.id]));

  // Compute job-link coverage (exact + safe normalized).
  const linkable = new Set();
  const unmatchedCustomers = [];
  for (const c of clients) {
    for (const cand of c.jobCandidates) {
      const job = resolveJob(cand);
      if (job) linkable.add(job);
      else unmatchedCustomers.push(cand);
    }
  }
  const jobsWithoutClient = [...validJobIds].filter((j) => !linkable.has(j));

  console.log(`\nParsed ${rows.length} CSV rows -> ${clients.length} unique clients`);
  console.log(`  with email:      ${clients.filter((c) => c.email).length}`);
  console.log(`  name fallback:   ${clients.filter((c) => c.nameIsFallback).length} (no clean person name -> used QBO customer name)`);
  console.log(`Job links: ${linkable.size}/${validJobIds.size} jobs will be linked to a client`);
  if (DRY_RUN) console.log('\n*** DRY RUN — nothing will be written ***');

  if (DRY_RUN) {
    console.log('\n--- CLIENTS (sample of first 12) ---');
    for (const c of clients.slice(0, 12)) {
      console.log(`  ${c.name.padEnd(24)} ${(c.email || '(no email)').padEnd(34)} ${c.phone || ''}  [jobs: ${[...c.jobCandidates].filter((j) => validJobIds.has(j)).length}]`);
    }
    console.log(`\n--- Near-miss links recovered (normalized, ${fuzzyLinks.length}) ---`);
    fuzzyLinks.sort((a, b) => a.job_id.localeCompare(b.job_id))
      .forEach((l) => console.log(`  QBO "${l.customer}"  ->  job ${l.job_id}`));
    console.log(`\n--- QBO customers with NO matching job (${unmatchedCustomers.length}) — manual review ---`);
    unmatchedCustomers.sort().forEach((n) => console.log(`  - ${n}`));
    console.log(`\n--- Jobs with NO client after import (${jobsWithoutClient.length}) ---`);
    jobsWithoutClient.sort().forEach((n) => console.log(`  - ${n}`));
    return;
  }

  // Insert clients, then link jobs.
  let inserted = 0, skipped = 0, linked = 0, failed = 0;
  for (const c of clients) {
    let clientId = c.email ? existingByEmail.get(c.email) : null;
    if (clientId) {
      skipped++;
    } else {
      const { data, error } = await supabase
        .from('clients')
        .insert({
          name: c.name,
          email: c.email,
          phone: c.phone,
          type: 'homeowner', // default; reclassify later (investor/contractor/homeowner/other)
          notes: 'Imported from QBO Customer Contact List' + (c.nameIsFallback ? ' — name needs review' : ''),
        })
        .select('id')
        .single();
      if (error) { console.error(`  FAIL client ${c.name}: ${error.message}`); failed++; continue; }
      clientId = data.id;
      if (c.email) existingByEmail.set(c.email, clientId);
      inserted++;
    }
    for (const cand of c.jobCandidates) {
      const job = resolveJob(cand);
      if (!job) continue;
      const { error } = await supabase.from('jobs').update({ client_id: clientId }).eq('job_id', job);
      if (error) console.error(`  FAIL link ${job}: ${error.message}`);
      else linked++;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Clients inserted:  ${inserted}`);
  console.log(`Clients skipped:   ${skipped} (already existed)`);
  console.log(`Jobs linked:       ${linked}`);
  if (failed) console.log(`Failed:            ${failed}`);
}

main().catch(console.error);
