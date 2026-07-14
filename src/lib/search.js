// Global search: the pure matcher behind the top-bar box. No React, no network —
// it takes the jobs + clients already in memory and returns ranked hits, so the
// ranking rules are unit-testable on their own (tests/search.test.js).
//
// Why rank at all: typing "deuel" against 134 jobs returns five, and the one the
// staffer wants is almost never alphabetically first. The rules, in order:
//   1. an exact Job ID beats everything (you typed the key)
//   2. a match at the START of a name beats one in the middle ("dan" → Dan Nosker
//      before Avedissian)
//   3. a name/ID match beats an address or notes match (you searched a who, not a where)
//   4. active work beats finished work — a completed job is rarely the target
import { phaseLabel, addressLine, PHASE_ORDER } from './format.js';

export const SEARCH_LIMIT = 8;

// Terminal phases: still findable, just never ranked above live work.
const COLD_PHASES = ['completed', 'canceled', 'job_dropped'];

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Where the needle lands in the haystack, as a rank contribution.
//   0 = no match · 3 = exact · 2 = starts with · 1 = contains
function hitScore(hay, needle) {
  const h = norm(hay);
  if (!h || !needle) return 0;
  if (h === needle) return 3;
  if (h.startsWith(needle)) return 2;
  // Also treat the start of any word as a prefix hit: "nosker" in "Dunn Nosker".
  if (h.includes(` ${needle}`) || h.includes(`_${needle}`)) return 2;
  return h.includes(needle) ? 1 : 0;
}

function scoreJob(job, q) {
  const idHit = hitScore(job.job_id, q);
  const nameHit = hitScore(job.client_name, q);
  const addrHit = hitScore(addressLine(job.address), q);
  const noteHit = hitScore(job.notes, q);
  if (!idHit && !nameHit && !addrHit && !noteHit) return 0;

  // Weighted so a strong ID/name hit always outranks a weak address/notes one.
  let score = idHit * 10 + nameHit * 10 + addrHit * 3 + noteHit;
  if (COLD_PHASES.includes(job.phase)) score -= 5;
  return score;
}

function scoreClient(client, q) {
  const nameHit = hitScore(client.name, q);
  const coHit = hitScore(client.company, q);
  const emailHit = hitScore(client.email, q);
  if (!nameHit && !coHit && !emailHit) return 0;

  let score = nameHit * 10 + coHit * 6 + emailHit * 2;
  if (client.is_active === false) score -= 5;
  return score;
}

/**
 * Rank jobs + clients against a query.
 * @returns {Array<{kind:'job'|'client', id:string, title:string, meta:string, score:number}>}
 */
export function searchRecords(query, jobs = [], clients = [], limit = SEARCH_LIMIT) {
  const q = norm(query);
  if (!q) return [];

  const hits = [];

  for (const job of jobs) {
    const score = scoreJob(job, q);
    if (score <= 0) continue;
    hits.push({
      kind: 'job',
      id: job.job_id,
      title: job.client_name ? `${job.client_name} — ${job.job_id}` : job.job_id,
      meta: phaseLabel(job),
      score,
      // Tie-break by lifecycle position so, all else equal, later-stage work sorts first.
      order: PHASE_ORDER.indexOf(job.phase),
    });
  }

  for (const client of clients) {
    const score = scoreClient(client, q);
    if (score <= 0) continue;
    hits.push({
      kind: 'client',
      id: client.id,
      title: client.name || 'Unnamed client',
      meta: client.company || client.email || '',
      score,
      order: -1,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || b.order - a.order || a.title.localeCompare(b.title))
    .slice(0, limit);
}
