// Gmail READ helpers — full message bodies + attachments for the Mail page.
//
// The Priority Inbox (api/inbox.js) only ever asked Gmail for `format=metadata`,
// so the app had a sender and a subject and nothing else. Reading a message means
// `format=full`, which returns a recursive MIME tree — hence walkParts() below.
//
// Everything here except gmailGet() is PURE (no network, no db), so the MIME
// walking and the HTML sanitising are unit-tested against fixture payloads
// instead of against someone's live mailbox. See tests/gmail-read.test.js.
//
// Companion to api/_lib/gmail-send.js (which sends AS the signed-in staffer).

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function gmailGet(path, token) {
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

// Gmail returns base64url with no padding.
export function decodeB64Url(data) {
  if (!data) return '';
  try {
    return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// payload.headers is an array of {name, value}; header names are case-insensitive.
export function headerMap(payload) {
  return Object.fromEntries(
    (payload?.headers || []).map((h) => [String(h.name || '').toLowerCase(), h.value]),
  );
}

// `"John Smith" <john@x.com>` -> { name, email }
export function parseAddress(value = '') {
  const m = String(value).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: String(value).trim().toLowerCase() };
}

// Split an address header on commas that aren't inside quotes or angle brackets.
export function parseAddressList(value = '') {
  const out = [];
  let buf = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of String(value)) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) {
      if (buf.trim()) out.push(parseAddress(buf));
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(parseAddress(buf));
  return out.filter((a) => a.email);
}

// Walk the MIME tree and pull out the readable body + every attachment.
//
// Real mail is messier than "one part per type": a reply from Outlook is
// multipart/alternative nested inside multipart/mixed, and inline images arrive
// as parts WITH a filename but referenced from the HTML by Content-ID. We keep
// inline parts separate from real attachments so a signature logo doesn't show
// up in the attachment strip as if the client sent you a file.
export function walkParts(payload) {
  const out = { text: '', html: '', attachments: [], inline: [] };
  if (!payload) return out;

  const visit = (part) => {
    if (!part) return;
    const mime = String(part.mimeType || '').toLowerCase();
    const headers = headerMap(part);
    const disposition = String(headers['content-disposition'] || '').toLowerCase();
    const contentId = String(headers['content-id'] || '').replace(/^<|>$/g, '');
    const attachmentId = part.body?.attachmentId;
    const filename = part.filename || '';

    if (Array.isArray(part.parts) && part.parts.length) {
      part.parts.forEach(visit);
      // A multipart node can still carry a filename (e.g. an attached .eml);
      // fall through so it is not lost.
    }

    if (attachmentId && filename) {
      const record = {
        attachmentId,
        filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body?.size || 0,
        contentId: contentId || null,
      };
      // Inline == referenced from the HTML body, not a file the sender "attached".
      if (disposition.startsWith('inline') && contentId) out.inline.push(record);
      else out.attachments.push(record);
      return;
    }

    if (mime === 'text/plain' && !filename) {
      const t = decodeB64Url(part.body?.data);
      if (t && !out.text) out.text = t;
      return;
    }
    if (mime === 'text/html' && !filename) {
      const h = decodeB64Url(part.body?.data);
      if (h && !out.html) out.html = h;
    }
  };

  visit(payload);
  return out;
}

// Strip anything executable from sender-controlled HTML.
//
// ⚠️ This is the SECOND line of defence, not the first. The body renders in an
// iframe with `sandbox` and no allow-scripts, so script execution is already
// impossible — but a sanitiser here means a future change to how the body is
// mounted can't silently turn every client email into an XSS vector.
//
// Remote images are neutralised by default (src -> data-blocked-src). A tracking
// pixel in a client's email would otherwise tell a sender the exact moment staff
// opened it, from the office IP. The UI offers a per-message "Show images".
export function sanitizeEmailHtml(html, { allowRemoteImages = false } = {}) {
  let out = String(html || '');
  let blockedImages = 0;

  // Drop whole elements that can execute or navigate.
  out = out.replace(/<\s*(script|iframe|object|embed|applet|form|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|iframe|object|embed|applet|form|link|meta|base)\b[^>]*\/?>/gi, '');

  // Inline event handlers: onclick=, onerror=, onload=…
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // javascript:/vbscript: URLs in href/src/action.
  out = out.replace(/((?:href|src|action)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'>\s]*/gi, '$1$2#');

  if (!allowRemoteImages) {
    out = out.replace(/<img\b[^>]*>/gi, (tag) => {
      if (!/\ssrc\s*=/i.test(tag)) return tag;
      // cid: images are the message's own inline parts — resolved separately, not remote.
      if (/\ssrc\s*=\s*["']?cid:/i.test(tag)) return tag;
      blockedImages += 1;
      return tag.replace(/\ssrc\s*=/i, ' data-blocked-src=');
    });
  }

  return { html: out, blockedImages };
}

// NOTE: `cid:` inline images are resolved CLIENT-side (src/lib/mail-html.js), not
// here. An <img> tag cannot carry the Clerk Authorization header, so a URL pointing
// at /api/inbox/attachment would just 401. The browser fetches each inline part
// through apiFetch and swaps in a blob: URL — the same pattern ProposalDocs.jsx
// uses for signed proposal PDFs.

// Resolve the Content-Type to actually serve an attachment with.
//
// ⚠️ Load-bearing for in-app preview. Many mail clients declare a PDF as
// `application/octet-stream`; serving that back makes the browser DOWNLOAD the
// file no matter what Content-Disposition says, so an in-app viewer would show
// nothing. When the declared type is generic we infer from the extension.
const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain',
};
const GENERIC_MIME = /^(application\/(octet-stream|binary|force-download|x-download)|binary\/octet-stream|)$/i;

export function effectiveMime(filename = '', declared = '') {
  const mime = String(declared || '').toLowerCase().split(';')[0].trim();
  if (mime && !GENERIC_MIME.test(mime)) return mime;
  const ext = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && EXT_MIME[ext]) || mime || 'application/octet-stream';
}

// Gmail marks unread with the UNREAD label; there is no boolean on the message.
export function isUnread(msg) {
  return (msg?.labelIds || []).includes('UNREAD');
}

// A thread's subject is its first message's — later replies carry "Re:" noise.
export function threadSubject(messages) {
  const first = messages?.[0];
  return (first?.subject || '(no subject)').replace(/^\s*(re|fwd?)\s*:\s*/i, '').trim() || '(no subject)';
}
