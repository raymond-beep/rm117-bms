// Link unlinked jobs (jobs.client_id IS NULL) to existing client records by name.
// HIGH-CONFIDENCE ONLY: an exact normalized full-name match, or a surname that
// belongs to exactly one client. Anything ambiguous (repeated surname, typo,
// company/placeholder name) is left for manual review.
//
// Usage:
//   node scripts/link-jobs-to-clients.js            # dry-run (default) — proposes, writes nothing
//   node scripts/link-jobs-to-clients.js --apply     # writes the high-confidence links
import 'dotenv/config';
import { getDb, hasDb } from '../api/_lib/db.js';

const APPLY = process.argv.includes('--apply');

const STOP = new Set(['and', 'the', 'team', 'architect', 'llc', 'inc', 'jr', 'sr', 'ii', 'iii']);

// Clean a free-text client_name into comparable tokens: drop phone numbers,
// anything after '/', '(', or '-' separators, and stop words.
function clean(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(/[/(]/)[0]                 // drop "/ second name", "(notes)"
    .replace(/\d[\d\-().\s]{5,}\d/g, '') // strip phone numbers
    .trim();
}
function tokens(name) {
  return clean(name).split(/[^a-z]+/).filter((t) => t.length > 1 && !STOP.has(t));
}
function fullKey(name) { return tokens(name).join(' '); }
function surname(name) { const t = tokens(name); return t[t.length - 1] || null; }

async function main() {
  if (!hasDb()) { console.error('No Supabase env — aborting.'); process.exit(1); }
  const db = getDb();

  const [{ data: jobs, error: je }, { data: clients, error: ce }] = await Promise.all([
    db.from('jobs').select('job_id, client_name, client_id').is('client_id', null),
    db.from('clients').select('id, name'),
  ]);
  if (je || ce) { console.error(je || ce); process.exit(1); }

  const byFull = new Map();      // fullKey -> [client]
  const bySurname = new Map();   // surname -> [client]
  for (const c of clients) {
    const fk = fullKey(c.name);
    const sn = surname(c.name);
    if (fk) { if (!byFull.has(fk)) byFull.set(fk, []); byFull.get(fk).push(c); }
    if (sn) { if (!bySurname.has(sn)) bySurname.set(sn, []); bySurname.get(sn).push(c); }
  }

  const links = [];     // { job_id, client_id, client_name, via }
  const skipped = [];   // { job_id, client_name, reason }

  for (const j of jobs) {
    const fk = fullKey(j.client_name);
    const sn = surname(j.client_name);
    if (!fk) { skipped.push({ job_id: j.job_id, client_name: j.client_name, reason: 'no usable name' }); continue; }

    const fullHits = byFull.get(fk) || [];
    if (fullHits.length === 1) { links.push({ job_id: j.job_id, client_id: fullHits[0].id, client: fullHits[0].name, via: 'full' }); continue; }
    if (fullHits.length > 1) { skipped.push({ job_id: j.job_id, client_name: j.client_name, reason: `full name -> ${fullHits.length} clients` }); continue; }

    const snHits = bySurname.get(sn) || [];
    if (snHits.length === 1) { links.push({ job_id: j.job_id, client_id: snHits[0].id, client: snHits[0].name, via: 'surname' }); continue; }
    skipped.push({ job_id: j.job_id, client_name: j.client_name, reason: snHits.length ? `surname '${sn}' -> ${snHits.length} clients` : 'no client match' });
  }

  console.log(`\n=== PROPOSED LINKS (${links.length}) ===`);
  for (const l of links) console.log(`  ${l.via.padEnd(7)} ${l.job_id.padEnd(34)} -> ${l.client}`);
  console.log(`\n=== SKIPPED (${skipped.length}) ===`);
  for (const s of skipped) console.log(`  ${s.job_id.padEnd(34)} (${s.client_name ?? 'null'}) — ${s.reason}`);

  if (!APPLY) { console.log(`\nDry-run. Re-run with --apply to write ${links.length} links.`); return; }

  let ok = 0;
  for (const l of links) {
    const { error } = await db.from('jobs').update({ client_id: l.client_id }).eq('job_id', l.job_id);
    if (error) console.error(`  FAIL ${l.job_id}: ${error.message}`); else ok++;
  }
  console.log(`\nApplied ${ok}/${links.length} links.`);
}

main();
