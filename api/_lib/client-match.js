// Client-sender matching for the Priority Inbox.
// Now that the `clients` table is populated from QBO (name + email) and jobs
// carry client_id, matching is driven by EXACT EMAIL first. A tightened
// surname-only fallback catches clients whose email we don't have yet, without
// the old false positives (newsletters matching on words like "and"/"park").
//
// Match priority:
//   1. clients.email (exact) -> label + the client's linked job_ids
//   2. sender surname == a job's client surname (display-name tokens only)

const STOP = new Set([
  'ff', 'fe', 'llc', 'inc', 'the', 'and', 'lot', 'new',
  'st', 'rd', 'ave', 'dr', 'ln', 'ct', 'blvd', 'pl',
  'lane', 'place', 'road', 'street', 'avenue', 'drive', 'court', 'circle',
  'way', 'terrace', 'boulevard', 'north', 'south', 'east', 'west',
  'cafe', 'sign', 'zoning', 'subdivide', 'garage', 'bathroom', 'interiors',
  'antique', 'car', 'fire', 'escapes',
]);

const JOBID_PREFIX = /^\d{2}_\d{3}_/;

function tokens(str) {
  return (str || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// The strongest single signal: the last meaningful token (surname).
function surname(str) {
  const t = tokens(str);
  return t[t.length - 1] || null;
}

// Build a matcher from jobs (job_id, client_name, client_id) and clients
// (id, name, email). Returns { match(sender) } where sender = { name, email }.
export function buildMatcher(jobs, clients = []) {
  // client_id -> [job_id]
  const clientJobs = new Map();
  for (const j of jobs) {
    if (!j.client_id) continue;
    if (!clientJobs.has(j.client_id)) clientJobs.set(j.client_id, []);
    clientJobs.get(j.client_id).push(j.job_id);
  }

  // email -> { label, jobs }
  const emailToClient = new Map();
  for (const c of clients) {
    if (!c.email) continue;
    emailToClient.set(c.email.toLowerCase().trim(), {
      label: c.name || c.email,
      jobs: clientJobs.get(c.id) || [],
    });
  }

  // surname -> { jobs:Set<job_id>, label } for the name fallback
  const surnameIndex = new Map();
  for (const j of jobs) {
    const namePart = (j.job_id || '').replace(JOBID_PREFIX, '');
    const sn = surname(j.client_name) || surname(namePart);
    if (!sn) continue;
    if (!surnameIndex.has(sn)) {
      surnameIndex.set(sn, { jobs: new Set(), label: j.client_name || namePart || j.job_id });
    }
    surnameIndex.get(sn).jobs.add(j.job_id);
  }

  return {
    match(sender) {
      const email = (sender.email || '').toLowerCase().trim();
      if (email && emailToClient.has(email)) {
        const hit = emailToClient.get(email);
        return { isClient: true, label: hit.label, via: 'email', jobs: hit.jobs };
      }
      // Fallback: match the sender's DISPLAY-NAME surname against a job surname.
      // (We deliberately ignore the email local-part here — it was a noise source.)
      let best = null;
      for (const t of tokens(sender.name)) {
        const hit = surnameIndex.get(t);
        if (!hit) continue;
        const jobsArr = [...hit.jobs];
        if (!best || jobsArr.length < best.jobs.length) {
          best = { isClient: true, label: hit.label, via: 'name', jobs: jobsArr, token: t };
        }
      }
      return best || { isClient: false };
    },
  };
}
