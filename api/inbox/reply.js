// POST /api/inbox/reply — reply to a thread AS the signed-in staff member.
//
// Body: { threadId, messageId, to: [email], cc: [email], subject, text }
//
// Sends through the staffer's own Gmail (api/_lib/gmail-send.js), so the reply
// comes from a person rather than a noreply@ address, lands in their Sent
// folder, and any answer goes back to their real inbox. Uses the `gmail.send`
// scope that portal notifications already established — no new consent.
//
// ⚠️ Recipients are recomputed HERE from the thread, not trusted from the client.
// A reply-all on a developer's thread can reach their whole team, so the address
// list is derived server-side from the message actually being answered.
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken, getUserEmail } from '../_lib/clerk.js';
import { sendAsUser, replySubject, buildReferences } from '../_lib/gmail-send.js';
import { gmailGet, headerMap, parseAddress, parseAddressList } from '../_lib/gmail-read.js';

const STAFF_DOMAIN = '@rm117.com';

// Format an address list for a header, preserving display names.
function formatAddresses(list) {
  return list
    .map((a) => (a.name ? `${a.name.replace(/[",]/g, '')} <${a.email}>` : a.email))
    .join(', ');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await requireStaff(req, res);
  if (!userId) return;

  const { threadId, messageId, text, replyAll = false, to: toOverride } = req.body || {};
  if (!threadId || !messageId) {
    return res.status(400).json({ error: 'threadId and messageId are required' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Message body is empty' });
  }

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(409).json({ error: 'google_not_connected', reason: error });

  try {
    // Re-read the message being answered so the headers are authoritative.
    const msg = await gmailGet(
      `/messages/${encodeURIComponent(messageId)}?format=metadata`
      + '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject'
      + '&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Reply-To',
      token,
    );
    if (msg.threadId !== threadId) {
      return res.status(400).json({ error: 'Message does not belong to that thread' });
    }

    const h = headerMap(msg.payload);
    const me = (await getUserEmail(userId)) || '';
    const from = h['reply-to'] ? parseAddress(h['reply-to']) : parseAddress(h.from || '');
    const origTo = parseAddressList(h.to || '');
    const origCc = parseAddressList(h.cc || '');

    // Build the recipient set server-side (mirrors src/lib/mail-html.js
    // replyRecipients, which drives the UI preview).
    const seen = new Set([me.toLowerCase()]);
    const to = [];
    const cc = [];
    const push = (list, addr) => {
      const e = (addr?.email || '').toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      list.push(addr);
    };
    push(to, from);
    if (replyAll) {
      origTo.forEach((a) => push(to, a));
      origCc.forEach((a) => push(cc, a));
    }

    // An explicit To from the UI may narrow the list but never widen it —
    // otherwise a tampered request could mail anyone from a staff account.
    if (Array.isArray(toOverride) && toOverride.length) {
      const allowed = new Set([...to, ...cc].map((a) => a.email.toLowerCase()));
      const narrowed = toOverride
        .map((e) => String(e).toLowerCase().trim())
        .filter((e) => allowed.has(e));
      if (narrowed.length) {
        const byEmail = new Map([...to, ...cc].map((a) => [a.email.toLowerCase(), a]));
        to.length = 0; cc.length = 0;
        narrowed.forEach((e) => to.push(byEmail.get(e)));
      }
    }

    if (!to.length) return res.status(400).json({ error: 'No recipient for this reply' });

    const out = await sendAsUser(userId, {
      to: formatAddresses(to),
      cc: cc.length ? formatAddresses(cc) : undefined,
      subject: replySubject(h.subject),
      text: String(text),
      inReplyTo: h['message-id'] || undefined,
      references: buildReferences(h.references, h['message-id']) || undefined,
      threadId,
    });

    res.status(200).json({
      ok: true,
      id: out.id,
      threadId: out.threadId,
      to: to.map((a) => a.email),
      cc: cc.map((a) => a.email),
    });
  } catch (err) {
    if (err.code === 'google_send_not_granted') {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    if (err.status === 404) return res.status(404).json({ error: 'Message not found' });
    console.error('[api/inbox/reply]', err);
    res.status(500).json({ error: err.message || 'Send failed' });
  }
}

export { formatAddresses, STAFF_DOMAIN };
