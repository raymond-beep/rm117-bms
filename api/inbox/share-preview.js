// GET /api/inbox/share-preview?threadId=&jobId=
//
// "What will the client actually see?" — answered BEFORE anything is shared.
//
// Ray's call is that a client sees the WHOLE conversation: a filtered slice
// (three of seven messages, replies referencing things they cannot see) reads as
// broken and is worse than showing nothing. So the safety here is not a filter,
// it is a person looking at the real thing first — the same pattern the client
// update email already uses, where portal/draft composes and sends nothing purely
// so the confirm dialog can show what will go out.
//
// What this adds on top of "show the thread": every message is checked against
// the CLIENT'S OWN addresses (their contacts, not just the primary email), and
// any message they were not on is flagged. That is the one genuinely dangerous
// case — internal replies between staff, a township, an engineer, or another
// client reached by a forward — and flagging makes it a visible decision instead
// of an accident.
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken } from '../_lib/clerk.js';
import {
  gmailGet, headerMap, parseAddress, parseAddressList, walkParts, threadSubject,
} from '../_lib/gmail-read.js';

// Every address that belongs to this client — the primary on `clients` plus each
// active contact. Developers run teams, so "the client" is rarely one address.
async function clientAddresses(db, clientId) {
  if (!clientId) return { emails: new Set(), name: null, people: [] };
  const [{ data: client }, { data: contacts }] = await Promise.all([
    db.from('clients').select('id, name, email').eq('id', clientId).maybeSingle(),
    db.from('client_contacts').select('name, email, is_active').eq('client_id', clientId),
  ]);
  const people = [];
  const emails = new Set();
  if (client?.email) { emails.add(client.email.toLowerCase().trim()); people.push({ name: client.name, email: client.email }); }
  for (const c of contacts || []) {
    if (c.is_active === false || !c.email) continue;
    const e = c.email.toLowerCase().trim();
    if (emails.has(e)) continue;
    emails.add(e);
    people.push({ name: c.name, email: c.email });
  }
  return { emails, name: client?.name || null, people };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const userId = await requireStaff(req, res);
  if (!userId) return;
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const db = getDb();

  const url = new URL(req.url, 'http://localhost');
  const threadId = url.searchParams.get('threadId');
  const jobId = url.searchParams.get('jobId');
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  // Resolve the client from the job being filed against — the portal is keyed by
  // client, while the rest of the app speaks Job ID.
  let clientId = url.searchParams.get('clientId') || null;
  if (!clientId && jobId) {
    const { data: job } = await db.from('jobs').select('client_id').eq('job_id', jobId).maybeSingle();
    clientId = job?.client_id || null;
  }
  const { emails, name, people } = await clientAddresses(db, clientId);

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(409).json({ error: 'google_not_connected', reason: error });

  try {
    const gthread = await gmailGet(`/threads/${encodeURIComponent(threadId)}?format=full`, token);

    const messages = (gthread.messages || []).map((msg) => {
      const h = headerMap(msg.payload);
      const from = parseAddress(h.from || '');
      const to = parseAddressList(h.to || '');
      const cc = parseAddressList(h.cc || '');
      const parts = walkParts(msg.payload);
      const onIt = [from, ...to, ...cc].some((a) => emails.has(a.email));
      return {
        id: msg.id,
        from: { name: from.name, email: from.email },
        date: h.date || null,
        subject: h.subject || '',
        snippet: msg.snippet || '',
        attachments: parts.attachments.map((a) => a.filename),
        // ⚠️ The load-bearing field. False = the client was never on this
        // message, so sharing it reveals something new to them.
        clientWasOn: onIt,
      };
    });

    res.status(200).json({
      threadId,
      subject: threadSubject(messages.map((m) => ({ subject: m.subject }))),
      client: clientId ? { id: clientId, name, contacts: people } : null,
      messageCount: messages.length,
      notOnCount: messages.filter((m) => !m.clientWasOn).length,
      messages,
      // No client on the job means we cannot tell what is new to them — the UI
      // must say so rather than imply everything is safe.
      unknownClient: !clientId,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(409).json({ error: 'google_reauth_needed' });
    }
    console.error('[api/inbox/share-preview]', err);
    res.status(500).json({ error: err.message });
  }
}
