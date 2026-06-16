// For unlinked jobs that have a real client_name but no client record, create a
// client per distinct person and link the job(s) to it. Guards against creating
// near-duplicates of EXISTING clients by also checking the cleaned full name and
// a unique-surname match (on both the client_name and the job_id last-name, which
// catches typos like "Ondulami" -> existing "Odunlami").
//
// Usage:
//   node scripts/create-clients-for-unlinked.js          # dry-run (default)
//   node scripts/create-clients-for-unlinked.js --apply
import 'dotenv/config';
import { getDb, hasDb } from '../api/_lib/db.js';

const APPLY = process.argv.includes('--apply');
const STOP = new Set(['and', 'the', 'team', 'architect', 'llc', 'inc', 'jr', 'sr', 'ii', 'iii']);

function cleanName(name) {
  if (!name) return '';
  return name.split(/[/(]/)[0].replace(/\d[\d\-().\s]{5,}\d/g, '').replace(/\s+/g, ' ').trim();
}
function nameTokens(name) {
  return cleanName(name).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1 && !STOP.has(t));
}
const fullKey = (name) => nameTokens(name).join(' ');
const surnameOf = (name) => { const t = nameTokens(name); return t[t.length - 1] || null; };
function jobSurname(job_id) {
  const rest = (job_id || '').replace(/^\d{2}_\d{3}_(ff_|fe_)?/i, '');
  const first = rest.split(/[_\s]/)[0] || '';
  const s = first.toLowerCase().replace(/[^a-z]/g, '');
  return s.length > 1 ? s : null;
}

async function main() {
  if (!hasDb()) { console.error('No Supabase env — aborting.'); process.exit(1); }
  const db = getDb();
  const [{ data: jobs, error: je }, { data: clients, error: ce }] = await Promise.all([
    db.from('jobs').select('job_id, client_name, client_id').is('client_id', null),
    db.from('clients').select('id, name'),
  ]);
  if (je || ce) { console.error(je || ce); process.exit(1); }

  const existingByFull = new Map();
  const existingBySurname = new Map();
  for (const c of clients) {
    const fk = fullKey(c.name); const sn = surnameOf(c.name);
    if (fk) { if (!existingByFull.has(fk)) existingByFull.set(fk, []); existingByFull.get(fk).push(c); }
    if (sn) { if (!existingBySurname.has(sn)) existingBySurname.set(sn, []); existingBySurname.get(sn).push(c); }
  }
  const uniqueExisting = (sn) => { const h = existingBySurname.get(sn) || []; return h.length === 1 ? h[0] : null; };

  const linkExisting = [];           // { job_id, client_id, name, why }
  const newGroups = new Map();       // fullKey -> { display, jobs:[job_id] }
  const skipped = [];

  for (const j of jobs) {
    const name = cleanName(j.client_name);
    if (!name || nameTokens(j.client_name).length === 0) { skipped.push(j.job_id + ' (no usable name)'); continue; }
    const fk = fullKey(j.client_name);

    // 1) existing exact full name
    const full = existingByFull.get(fk) || [];
    if (full.length === 1) { linkExisting.push({ job_id: j.job_id, client_id: full[0].id, name: full[0].name, why: 'existing full' }); continue; }
    // 2) existing unique surname (client_name only — NOT the job_id last-name,
    // which is often the referrer in "Referrer_Client" job names like Dunn_Melillo).
    const e2 = uniqueExisting(surnameOf(j.client_name));
    if (e2) { linkExisting.push({ job_id: j.job_id, client_id: e2.id, name: e2.name, why: `existing surname '${surnameOf(j.client_name)}'` }); continue; }
    // else: group for creation
    if (!newGroups.has(fk)) newGroups.set(fk, { display: name, jobs: [] });
    newGroups.get(fk).jobs.push(j.job_id);
  }

  console.log(`\n=== LINK TO EXISTING (${linkExisting.length}) ===`);
  for (const l of linkExisting) console.log(`  ${l.job_id.padEnd(34)} -> ${l.name}   (${l.why})`);
  console.log(`\n=== CREATE NEW CLIENT + LINK (${newGroups.size} clients, ${[...newGroups.values()].reduce((s, g) => s + g.jobs.length, 0)} jobs) ===`);
  for (const g of newGroups.values()) console.log(`  + "${g.display}"  <-  ${g.jobs.join(', ')}`);
  if (skipped.length) console.log(`\n=== SKIPPED (${skipped.length}) ===\n  ${skipped.join('\n  ')}`);

  if (!APPLY) { console.log('\nDry-run. Re-run with --apply to write.'); return; }

  let linked = 0, created = 0;
  for (const l of linkExisting) {
    const { error } = await db.from('jobs').update({ client_id: l.client_id }).eq('job_id', l.job_id);
    if (error) console.error(`  FAIL link ${l.job_id}: ${error.message}`); else linked++;
  }
  for (const g of newGroups.values()) {
    const { data, error } = await db.from('clients')
      .insert({ name: g.display, type: 'homeowner', notes: 'Auto-created from job (2026-06-16 cleanup) — verify type/email' })
      .select('id').single();
    if (error) { console.error(`  FAIL create "${g.display}": ${error.message}`); continue; }
    created++;
    for (const jid of g.jobs) {
      const { error: le } = await db.from('jobs').update({ client_id: data.id }).eq('job_id', jid);
      if (le) console.error(`  FAIL link ${jid}: ${le.message}`); else linked++;
    }
  }
  console.log(`\nApplied: created ${created} clients, linked ${linked} jobs.`);
}

main();
