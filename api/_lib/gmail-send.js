// Send an email AS the signed-in staff member, through their own Gmail.
//
// Why Gmail and not a transactional service: rm117.com's DNS lives on a Wix account the
// firm doesn't control, so verifying a sending domain (Resend/Postmark) has been blocked
// for months. Gmail needs no DNS at all — and it's the better product anyway. A client
// update that arrives from "Ray Arocha" gets opened; one from noreply@ gets ignored. The
// reply lands in Ray's actual inbox, and the message shows up in his Sent folder, so there
// is a real record of what the client was told.
//
// Scope: `gmail.send` ONLY — it can send, it cannot read. Adding it does not widen what the
// app can see. The token comes from Clerk (the same Google connection the Inbox widget uses).
import { getGoogleToken } from './clerk.js';

const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// RFC 2047 — a subject line with an em-dash or a client's accented name must not arrive as
// mojibake, so non-ASCII subjects get encoded rather than sent raw.
export function encodeHeader(value) {
  const v = String(value ?? '');
  if (/^[\x20-\x7E]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

// Gmail wants a base64url-encoded RFC 822 message.
//
// `inReplyTo` / `references` are what make a reply JOIN its conversation rather
// than start a new one. Gmail's own threadId is not enough: other mail clients
// (and the recipient's server) thread on these headers, so without them a reply
// shows as a separate thread in the client's inbox even though it looks correct
// in ours. `references` should be the original's References header plus its
// Message-ID; `inReplyTo` is the Message-ID being answered.
export function buildMimeMessage({ to, cc, subject, text, fromName, inReplyTo, references }) {
  const headers = [
    fromName ? `From: ${encodeHeader(fromName)}` : null,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    `Content-Type: text/plain; charset="UTF-8"`,
    'Content-Transfer-Encoding: 8bit',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

// "Re:" exactly once, however many times it has already been round-tripped.
export function replySubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return 'Re:';
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

// The References chain for a reply: whatever the original carried, plus its own
// Message-ID. Kept as a pure function because a malformed chain silently breaks
// threading in the RECIPIENT's client, where we would never see it.
export function buildReferences(originalReferences, originalMessageId) {
  const parts = String(originalReferences || '').split(/\s+/).filter(Boolean);
  if (originalMessageId && !parts.includes(originalMessageId)) parts.push(originalMessageId);
  return parts.join(' ');
}

export function toBase64Url(raw) {
  return Buffer.from(raw, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Send as `userId`'s Google account. Throws with a readable message the UI can show —
// notably `google_send_not_granted`, which means the staffer needs to sign out and back in
// and accept the new Gmail permission (the scope was added after they last consented).
export async function sendAsUser(userId, {
  to, cc, subject, text, fromName, inReplyTo, references, threadId,
}) {
  const { token, error } = await getGoogleToken(userId);
  if (!token) {
    const e = new Error('Google is not connected for this account.');
    e.code = error || 'google_not_connected';
    throw e;
  }

  const raw = toBase64Url(buildMimeMessage({
    to, cc, subject, text, fromName, inReplyTo, references,
  }));
  const r = await fetch(GMAIL_SEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // threadId files the sent copy into the same conversation in OUR mailbox;
    // the In-Reply-To/References headers are what thread it in THEIRS.
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });

  if (!r.ok) {
    const body = await r.text();
    // 403 with an insufficient-scope body is the expected state until the gmail.send scope
    // is added AND the staffer re-consents. Say exactly that instead of "403".
    if (r.status === 401 || r.status === 403) {
      const e = new Error(
        'Your Google account hasn’t granted permission to send mail. Sign out and back in, and accept the Gmail permission.',
      );
      e.code = 'google_send_not_granted';
      e.detail = body.slice(0, 300);
      throw e;
    }
    const e = new Error(`Gmail refused the message (${r.status}).`);
    e.detail = body.slice(0, 300);
    throw e;
  }

  const out = await r.json();
  return { id: out.id, threadId: out.threadId };
}
