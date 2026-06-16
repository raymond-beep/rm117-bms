// GET /api/inbox — per-user Gmail Priority Inbox, filtered to client senders.
// Phase 0. Each signed-in user sees THEIR OWN Gmail (read-only). We never use a
// shared mailbox (Ang's call). Auth: Clerk session token in the Authorization
// header; the Google access token comes from Clerk (gmail.readonly scope).
//
// Response shape:
//   { connected: true, messages: [{ id, from, email, subject, date, snippet,
//       isClient, clientLabel, jobs }] }
//   { connected: false, reason: 'google_not_connected' }   -> UI shows Connect prompt
//
// Query params: ?days=14 (lookback window), ?clientsOnly=1 (only client mail).
import { getDb, hasDb } from './_lib/db.js';
import { hasClerk, getUserId, getGoogleToken } from './_lib/clerk.js';
import { buildMatcher } from './_lib/client-match.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function parseFrom(value = '') {
  // "John Smith <john@x.com>"  ->  { name, email }
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: value.trim() };
}

async function gmailGet(path, token) {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error(`gmail ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Never cache — this is per-user, live data; a stale 304 would freeze the widget.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!hasClerk()) {
    return res.status(200).json({ connected: false, reason: 'clerk_not_configured' });
  }

  const userId = await getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { token, error } = await getGoogleToken(userId);
  if (error) {
    return res.status(200).json({ connected: false, reason: error });
  }

  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Number(url.searchParams.get('days')) || 14, 60);
  const clientsOnly = url.searchParams.get('clientsOnly') === '1';

  try {
    // 1. Build the client matcher from jobs (+ any clients with emails).
    let jobs = [];
    let clients = [];
    if (hasDb()) {
      const db = getDb();
      const [jRes, cRes] = await Promise.all([
        db.from('jobs').select('job_id, client_name, client_id'),
        db.from('clients').select('id, name, email'),
      ]);
      jobs = jRes.data || [];
      clients = cRes.data || [];
    }
    const matcher = buildMatcher(jobs, clients);

    // 2. List recent message ids from the user's inbox.
    const list = await gmailGet(
      `/messages?maxResults=40&q=${encodeURIComponent(`in:inbox newer_than:${days}d`)}`,
      token,
    );
    const ids = (list.messages || []).map((m) => m.id);

    // 3. Fetch metadata for each (From/Subject/Date) and match against clients.
    const settled = await Promise.all(
      ids.map((id) =>
        gmailGet(
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          token,
        ).catch(() => null),
      ),
    );

    const messages = [];
    for (const msg of settled) {
      if (!msg) continue;
      const headers = Object.fromEntries(
        (msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]),
      );
      const { name, email } = parseFrom(headers.from);
      const m = matcher.match({ name, email });
      if (clientsOnly && !m.isClient) continue;
      messages.push({
        id: msg.id,
        from: name || email,
        email,
        subject: headers.subject || '(no subject)',
        date: headers.date || null,
        snippet: msg.snippet || '',
        isClient: Boolean(m.isClient),
        clientLabel: m.label || null,
        jobs: m.jobs || [],
      });
    }

    // Client mail first, then most recent.
    messages.sort((a, b) => (b.isClient - a.isClient) || (new Date(b.date) - new Date(a.date)));

    res.status(200).json({ connected: true, count: messages.length, messages });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Token expired or scope not granted — treat as needs-reconnect.
      return res.status(200).json({ connected: false, reason: 'google_reauth_needed' });
    }
    console.error('[api/inbox]', err);
    res.status(500).json({ error: err.message });
  }
}
