// GET /api/inbox/thread?id=<threadId> — one full Gmail thread, ready to render.
//
// The Priority Inbox could only ever show a sender + subject + snippet, so the
// widget was a dead end: you saw that a client had written and then had to leave
// the app to find out what they said. This returns the whole conversation —
// every message, both sides, with bodies and attachment manifests.
//
// Reads the SIGNED-IN STAFFER'S OWN mailbox (never a shared one — Ang's call),
// using the gmail.readonly scope that is already granted. No new consent.
//
// ⚠️ readonly cannot write labels, so opening a thread here does NOT mark it read
// in Gmail. Unread state is display-only until/unless gmail.modify is granted.
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken } from '../_lib/clerk.js';
import {
  gmailGet, headerMap, parseAddress, parseAddressList, walkParts,
  sanitizeEmailHtml, isUnread, threadSubject, decodeB64Url, describePayload,
} from '../_lib/gmail-read.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const userId = await requireStaff(req, res);
  if (!userId) return;

  const url = new URL(req.url, 'http://localhost');
  const threadId = url.searchParams.get('id');
  const allowRemoteImages = url.searchParams.get('images') === '1';
  if (!threadId) return res.status(400).json({ error: 'id is required' });

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(200).json({ connected: false, reason: error });

  try {
    const thread = await gmailGet(`/threads/${encodeURIComponent(threadId)}?format=full`, token);

    // Fetch any body that was too large to arrive inline (see walkParts).
    const fetchPart = async (messageId, attachmentId) => {
      try {
        const a = await gmailGet(
          `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
          token,
        );
        return decodeB64Url(a.data);
      } catch {
        return '';
      }
    };

    const messages = await Promise.all((thread.messages || []).map(async (msg) => {
      const h = headerMap(msg.payload);
      const parts = walkParts(msg.payload);

      if (!parts.html && parts.htmlRef) parts.html = await fetchPart(msg.id, parts.htmlRef);
      if (!parts.text && parts.textRef) parts.text = await fetchPart(msg.id, parts.textRef);

      // `cid:` refs are left intact — the browser resolves them to blob: URLs
      // after fetching each inline part with auth (src/lib/mail-html.js).
      const clean = sanitizeEmailHtml(parts.html, { allowRemoteImages });

      // Local-dev diagnostic for "the body renders blank". Lengths only —
      // never the body itself. Off on Vercel.
      if (!process.env.VERCEL) {
        const visible = String(clean.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`[mail-debug] msg=${msg.id} text=${parts.text.length} html=${parts.html.length}`
          + ` sanitized=${(clean.html || '').length} visibleChars=${visible.length}`
          + ` blockedImgs=${clean.blockedImages}`
          + ` atts=${parts.attachments.length} inline=${parts.inline.length}`);
      }

      return {
        id: msg.id,
        threadId: msg.threadId,
        from: parseAddress(h.from || ''),
        to: parseAddressList(h.to || ''),
        cc: parseAddressList(h.cc || ''),
        replyTo: h['reply-to'] ? parseAddress(h['reply-to']) : null,
        messageIdHeader: h['message-id'] || null,
        references: h.references || null,
        subject: h.subject || '(no subject)',
        date: h.date || null,
        unread: isUnread(msg),
        snippet: msg.snippet || '',
        text: parts.text || '',
        html: clean.html || '',
        blockedImages: clean.blockedImages,
        attachments: parts.attachments.map((a) => ({
          attachmentId: a.attachmentId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
        // Signature logos / pasted screenshots the body references by Content-ID.
        // Kept separate so they never show up in the attachment strip as files
        // the client "sent" you.
        inline: parts.inline.map((a) => ({
          attachmentId: a.attachmentId,
          filename: a.filename,
          mimeType: a.mimeType,
          contentId: a.contentId,
        })),
      };
    }));

    res.status(200).json({
      connected: true,
      thread: {
        id: thread.id,
        subject: threadSubject(messages),
        messageCount: messages.length,
        messages,
      },
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(200).json({ connected: false, reason: 'google_reauth_needed' });
    }
    if (err.status === 404) return res.status(404).json({ error: 'Thread not found' });
    console.error('[api/inbox/thread]', err);
    res.status(500).json({ error: err.message });
  }
}
