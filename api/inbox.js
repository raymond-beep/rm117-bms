// GET /api/inbox — the staffer's own work mail, grouped into threads.
//
// Each signed-in user sees THEIR OWN Gmail (read-only). We never use a shared
// mailbox (Ang's call). Auth: Clerk session token in the Authorization header;
// the Google access token comes from Clerk (gmail.readonly scope).
//
// Response shape:
//   { connected: true, threads: [{ id, messageId, from, email, subject, date,
//       snippet, unread, messageCount, kind, isClient, clientLabel, jobs }] }
//   { connected: false, reason: 'google_not_connected' }   -> UI shows Connect prompt
// `messages` is kept as an alias of `threads` so the Home widget keeps working.
//
// Query params:
//   ?days=14        lookback window (max 60)
//   ?scope=work     work (default) | clients | all   — see classifySender()
//   ?clientsOnly=1  legacy alias for scope=clients
//   ?limit=40       thread cap (max 100)
import { getDb, hasDb } from './_lib/db.js';
import { hasClerk, getUserId, getGoogleToken } from './_lib/clerk.js';
import { buildMatcher, classifySender, inScope } from './_lib/client-match.js';
import {
  gmailGet, mapGmail, headerMap, parseAddress, parseAddressList, isUnread,
} from './_lib/gmail-read.js';

const STAFF_DOMAIN = '@rm117.com';

// Who is this conversation WITH? For anything the firm sent, the `From` is us —
// matching on it would file every outbound client email under "staff" and lose
// the client tag on exactly the half of the thread we wrote. So prefer the first
// non-RM117 participant, and fall back to the sender for internal mail.
export function counterparty(from, to) {
  const all = [from, ...(to || [])].filter((a) => a && a.email);
  const outside = all.find((a) => !a.email.endsWith(STAFF_DOMAIN));
  return outside || from || { name: '', email: '' };
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
  const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100);
  const scope = url.searchParams.get('clientsOnly') === '1'
    ? 'clients'
    : (url.searchParams.get('scope') || 'work');

  try {
    // 1. Build the client matcher from jobs + clients + every client CONTACT.
    let jobs = [];
    let clients = [];
    let contacts = [];
    if (hasDb()) {
      const db = getDb();
      const [jRes, cRes, ctRes] = await Promise.all([
        db.from('jobs').select('job_id, client_name, client_id'),
        db.from('clients').select('id, name, email'),
        db.from('client_contacts').select('client_id, name, email, is_active'),
      ]);
      jobs = jRes.data || [];
      clients = cRes.data || [];
      contacts = ctRes.data || [];
    }
    const matcher = buildMatcher(jobs, clients, contacts);

    // 2. List recent messages. SENT is included: a thread where the firm replied
    //    is still the conversation, and showing only the inbound half made the
    //    widget read as if nobody had answered the client.
    const q = `(in:inbox OR in:sent) newer_than:${days}d -in:chats`;
    const list = await gmailGet(
      `/messages?maxResults=${limit * 2}&q=${encodeURIComponent(q)}`,
      token,
    );
    const ids = (list.messages || []).map((m) => m.id);

    // 3. Metadata for each (From/To/Subject/Date), then match against clients.
    //
    // ⚠️ Read six at a time via mapGmail, and let a failure THROW. This was a
    // `Promise.all(...).catch(() => null)` over all ~120 ids, which trips Gmail's
    // per-user concurrency limit: messages came back 429 and were silently
    // discarded, so the list was quietly short and message counts were wrong —
    // the same mailbox reported 20 conversations on one load and 40 on the next.
    // A short list nobody can tell is short is the worst outcome for this page,
    // so an unrecoverable hole now surfaces as an error instead.
    const settled = await mapGmail(ids, (id) =>
      gmailGet(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To` +
        `&metadataHeaders=Subject&metadataHeaders=Date`,
        token,
      ),
    );

    // 4. Collapse to threads. Gmail already threads the conversation; the old
    //    flat list showed a five-reply exchange as five separate rows.
    const threads = new Map();
    for (const msg of settled) {
      if (!msg) continue;
      const h = headerMap(msg.payload);
      const from = parseAddress(h.from || '');
      const to = parseAddressList(h.to || '');
      const who = counterparty(from, to);
      const m = matcher.match(who);
      const kind = classifySender(who, m);
      if (!inScope(kind, scope)) continue;

      const when = h.date ? new Date(h.date).getTime() : 0;
      const prev = threads.get(msg.threadId);
      if (prev) {
        prev.messageCount += 1;
        prev.unread = prev.unread || isUnread(msg);
        // Keep the most recent message as the thread's face.
        if (when > prev._when) {
          Object.assign(prev, {
            _when: when, messageId: msg.id, date: h.date || null,
            snippet: msg.snippet || '', from: who.name || who.email,
          });
        }
        continue;
      }
      threads.set(msg.threadId, {
        id: msg.threadId,
        messageId: msg.id,
        _when: when,
        from: who.name || who.email,
        email: who.email,
        subject: (h.subject || '(no subject)').replace(/^\s*(re|fwd?)\s*:\s*/i, '') || '(no subject)',
        date: h.date || null,
        snippet: msg.snippet || '',
        unread: isUnread(msg),
        messageCount: 1,
        kind,
        isClient: kind === 'client',
        clientLabel: m.label || null,
        contactName: m.contactName || null,
        jobs: m.jobs || [],
      });
    }

    // 5. Newest first — full stop.
    //    The old sort put EVERY client message above everything else, so a
    //    13-day-old client note outranked something Ang sent an hour ago. That
    //    is a filter masquerading as a priority order; the scope filter and the
    //    client badge carry priority now, and the list stays chronological.
    const out = [...threads.values()]
      .sort((a, b) => b._when - a._when)
      .slice(0, limit)
      .map(({ _when, ...t }) => t);

    res.status(200).json({
      connected: true,
      scope,
      count: out.length,
      unreadCount: out.filter((t) => t.unread).length,
      threads: out,
      messages: out, // legacy alias — the Home widget reads `messages`
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Token expired or scope not granted — treat as needs-reconnect.
      return res.status(200).json({ connected: false, reason: 'google_reauth_needed' });
    }
    console.error('[api/inbox]', err);
    res.status(500).json({ error: err.message });
  }
}
