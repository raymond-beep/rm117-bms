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

// Build a matcher from jobs (job_id, client_name, client_id), clients
// (id, name, email) and client CONTACTS (client_id, name, email, is_active).
// Returns { match(sender) } where sender = { name, email }.
//
// ⭐ Contacts are why this exists in its current form. `clients.email` holds only
// the PRIMARY contact, but the firm's biggest clients are developers running teams
// — a Deuel or DaSilva project manager writes from their own address. Matching on
// clients.email alone tagged those people as "not a client", which is exactly
// backwards: the multi-person clients are the ones where correspondence matters
// most. Every contact's address now resolves to that client (and their jobs).
export function buildMatcher(jobs, clients = [], contacts = []) {
  // client_id -> [job_id]
  const clientJobs = new Map();
  for (const j of jobs) {
    if (!j.client_id) continue;
    if (!clientJobs.has(j.client_id)) clientJobs.set(j.client_id, []);
    clientJobs.get(j.client_id).push(j.job_id);
  }

  // email -> { label, jobs }
  const emailToClient = new Map();
  const clientById = new Map();
  for (const c of clients) {
    clientById.set(c.id, c);
    if (!c.email) continue;
    emailToClient.set(c.email.toLowerCase().trim(), {
      label: c.name || c.email,
      jobs: clientJobs.get(c.id) || [],
    });
  }

  // Contact addresses resolve to their client. Registered AFTER the primary
  // addresses above and only when absent, so a contact row can never shadow the
  // canonical clients.email entry. Deactivated contacts are skipped — a PM who
  // left the firm should stop being tagged as that developer.
  for (const ct of contacts) {
    const addr = (ct?.email || '').toLowerCase().trim();
    if (!addr || ct.is_active === false) continue;
    if (emailToClient.has(addr)) continue;
    const owner = clientById.get(ct.client_id);
    emailToClient.set(addr, {
      label: owner?.name || ct.name || addr,
      jobs: clientJobs.get(ct.client_id) || [],
      contactName: ct.name || null,
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
        return {
          isClient: true, label: hit.label, via: 'email',
          jobs: hit.jobs, contactName: hit.contactName || null,
        };
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

const STAFF_DOMAIN = '@rm117.com';

// Municipal / authority-having-jurisdiction domains. A building department or
// zoning board is not a client, but it is unambiguously work.
const GOV_SUFFIX = /\.(gov|us|mil)$/i;

// Classify a sender for the Mail page's filter.
//
// ⭐ The filter used to be "show ONLY matched clients", which quietly hid a huge
// share of an architecture firm's real correspondence: building departments,
// zoning boards, structural engineers, surveyors, contractors and the firm's own
// staff were all treated as junk because they aren't the people paying the bill.
// So the logic is inverted — HIDE KNOWN NOISE, keep everything else. 'clients'
// remains available as a deliberately narrow view.
//
//   client  — matched to a client record (or one of its contacts)
//   staff   — an @rm117.com colleague
//   project — a municipality/AHJ, or anyone else who isn't noise (engineers,
//             contractors, surveyors, expeditors — the long tail we can't enumerate)
//   noise   — SaaS/bulk/role/marketing senders
export function classifySender(sender, matchResult) {
  if (matchResult?.isClient) return 'client';
  const email = (sender?.email || '').toLowerCase().trim();
  if (email.endsWith(STAFF_DOMAIN)) return 'staff';
  if (isAutomatedSender(sender)) return 'noise';
  const domain = email.slice(email.indexOf('@') + 1);
  if (GOV_SUFFIX.test(domain)) return 'project';
  return 'project';
}

// Does this sender belong in the given view? `scope` is 'work' | 'clients' | 'all'.
export function inScope(kind, scope) {
  if (scope === 'all') return true;
  if (scope === 'clients') return kind === 'client';
  return kind !== 'noise'; // 'work' (default)
}
