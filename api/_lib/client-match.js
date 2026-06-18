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

// Email aliases: alternate addresses that belong to an existing client, mapped to
// that client's canonical `clients.email`. Resolved before any matching, so mail
// from these addresses tags to the same client + jobs as the canonical address —
// even when the local-part/domain/display-name wouldn't otherwise match.
// The DaSilva Group is one client (Gabe DaSilva, investor); these are its people.
const EMAIL_ALIASES = new Map([
  // → Gabe DaSilva (canonical client email = clientcare@amandanadiagroup.com)
  ['peter@dasilvagroupinc.com', 'clientcare@amandanadiagroup.com'], // Peter
  ['gabe.dasilva@gmail.com', 'clientcare@amandanadiagroup.com'],    // Gabe (personal)
]);

// Automated / role / bulk senders that must NEVER be tagged as a client via the
// surname fallback (e.g. "ClickUp Team", "no-reply@…"). Exact-email match against
// the clients table still wins — a real client emailing from their own address is
// unaffected. This only gates the fuzzy name fallback.
const AUTOMATED_LOCALPART = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notifications', 'notification',
  'notify', 'support', 'help', 'hello', 'info', 'contact', 'team', 'billing', 'invoices',
  'receipts', 'news', 'newsletter', 'newsletters', 'updates', 'update', 'alerts', 'alert',
  'mailer', 'mail', 'bounce', 'bounces', 'postmaster', 'admin', 'automated', 'auto',
  'account', 'accounts', 'service', 'services', 'marketing', 'sales', 'care', 'email',
]);

// Known bulk/SaaS sender domains — never client mail. Matched as a suffix so
// subdomains (e.g. mail.clickup.com) are covered too. Easy to extend.
const SAAS_DOMAINS = [
  'clickup.com', 'slack.com', 'atlassian.net', 'atlassian.com', 'notion.so', 'asana.com',
  'monday.com', 'trello.com', 'intuit.com', 'quickbooks.com', 'mailchimp.com', 'mailchimpapp.com',
  'sendgrid.net', 'hubspot.com', 'docusign.net', 'docusign.com', 'zapier.com', 'calendly.com',
  'google.com', 'googlemail.com', 'youtube.com', 'linkedin.com',
  'facebookmail.com', 'amazon.com', 'amazonses.com', 'dropbox.com', 'adobe.com', 'canva.com',
  'stripe.com', 'squareup.com', 'vercel.com', 'github.com', 'apple.com',
];

// Display-name words that signal an automated/bulk sender.
const AUTOMATED_NAME_WORDS = new Set(['team', 'support', 'notifications', 'billing', 'noreply', 'newsletter']);

function isAutomatedSender(sender) {
  const email = (sender.email || '').toLowerCase().trim();
  const at = email.indexOf('@');
  if (at > 0) {
    const local = email.slice(0, at).replace(/\+.*$/, ''); // drop +suffix
    const domain = email.slice(at + 1);
    if (AUTOMATED_LOCALPART.has(local)) return true;
    if (SAAS_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  }
  const nameWords = (sender.name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (nameWords.some((w) => AUTOMATED_NAME_WORDS.has(w))) return true;
  return false;
}

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
      const raw = (sender.email || '').toLowerCase().trim();
      // Resolve known alias addresses to the client's canonical email first.
      const email = EMAIL_ALIASES.get(raw) || raw;
      if (email && emailToClient.has(email)) {
        const hit = emailToClient.get(email);
        return { isClient: true, label: hit.label, via: 'email', jobs: hit.jobs };
      }
      // Automated/SaaS/role senders never reach the fuzzy fallback — only an
      // exact email match (handled above) can flag them as a client.
      if (isAutomatedSender(sender)) return { isClient: false };

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
