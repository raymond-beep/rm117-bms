// Client-side helpers for rendering an email body. Pure — no React, no network,
// so the rewriting rules are unit-tested (tests/mail-html.test.js).
//
// Inline images arrive as `<img src="cid:logo123">` pointing at one of the
// message's own MIME parts. They are resolved HERE rather than on the server
// because an <img> tag cannot carry the Clerk Authorization header — a URL
// aimed at /api/inbox/attachment would simply 401. The Mail page fetches each
// inline part through apiFetch and passes in a blob: URL.

export function resolveCidImages(html, inlineParts, urlFor) {
  if (!html || !inlineParts?.length) return html || '';
  const byId = new Map(inlineParts.filter((p) => p.contentId).map((p) => [p.contentId, p]));
  return String(html).replace(
    /(<img\b[^>]*\ssrc\s*=\s*)(["']?)cid:([^"'\s>]+)\2/gi,
    (m, pre, q, cid) => {
      const part = byId.get(cid);
      if (!part) return m;
      const quote = q || '"';
      return `${pre}${quote}${urlFor(part)}${quote}`;
    },
  );
}

// NOTE: the message body used to be wrapped into a full HTML document and served
// to a sandboxed iframe via srcdoc. That is gone — the body is now sanitised with
// DOMPurify and rendered inline (see src/components/mail/Mail.jsx), because a
// separate document cannot flow with the page and its height had to be
// negotiated over postMessage, which is what kept rendering it blank.

// Does this HTML actually render anything a person can see?
//
// A body can be non-empty as a STRING and still show nothing — an empty
// wrapper table, a stripped tracking pixel, `<div></div>`. Rendering that
// produced a blank white box with no explanation, so the caller uses this to
// fall back to the plain-text part instead of showing an empty frame.
export function htmlHasContent(html) {
  if (!html) return false;
  const s = String(html);
  if (/<(img|video|table|hr)\b/i.test(s)) return true;
  const text = s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}

export function formatBytes(n) {
  const size = Number(n) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Short, human date for a mail list: time today, weekday this week, else a date.
export function mailDate(value, now = new Date()) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = (now - d) / 86400000;
  if (days < 7 && days >= 0) return d.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
}

// What kind of thing is this attachment: 'pdf' | 'image' | 'other'?
//
// ⚠️ The declared MIME type is NOT reliable. Plenty of mail clients send a PDF as
// `application/octet-stream` (and some send no type at all), which is exactly what
// a real drawing set from a contractor looked like — seven PDFs, every one of them
// generic, so a mime-only check offered no preview on the one message where it
// mattered most. The filename extension is the more trustworthy signal in practice,
// so it wins whenever the declared type is missing or generic.
const GENERIC_MIME = /^(application\/(octet-stream|binary|force-download|x-download)|binary\/octet-stream|)$/i;
const EXT_PDF = /\.pdf$/i;
const EXT_IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function attachmentKind(filename = '', mimeType = '') {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (!GENERIC_MIME.test(mime)) {
    if (mime === 'application/pdf') return 'pdf';
    // SVG is an image but is scriptable — never previewed.
    if (/^image\/(png|jpeg|jpg|gif|webp|bmp)$/.test(mime)) return 'image';
    // A declared type we don't preview (zip, dwg, svg, …) still gets the
    // extension check below only if the type was generic — so fall through to
    // 'other' here rather than second-guessing an explicit declaration.
    if (mime) return 'other';
  }
  if (EXT_PDF.test(filename)) return 'pdf';
  if (EXT_IMAGE.test(filename)) return 'image';
  return 'other';
}

// Which attachments we are willing to show without a download.
export function canPreview(mimeType, filename = '') {
  return attachmentKind(filename, mimeType) !== 'other';
}

// Build the quoted original for a reply, the way every mail client does.
export function quoteForReply(message) {
  const who = message?.from?.name || message?.from?.email || 'someone';
  const when = message?.date ? new Date(message.date).toLocaleString() : '';
  const body = (message?.text || '').trim();
  const quoted = body.split('\n').map((l) => `> ${l}`).join('\n');
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}\n`;
}

// Reply-all recipients: everyone on the thread except us and duplicates.
// ⚠️ Getting this wrong mails a developer's whole team by accident, which is
// why it is a tested pure function rather than inline JSX logic.
export function replyRecipients(message, selfEmail, { all = false } = {}) {
  const me = (selfEmail || '').toLowerCase().trim();
  const sender = message?.replyTo?.email ? message.replyTo : message?.from;
  const to = [];
  const cc = [];
  const seen = new Set([me]);

  const push = (list, addr) => {
    const e = (addr?.email || '').toLowerCase().trim();
    if (!e || seen.has(e)) return;
    seen.add(e);
    list.push(addr);
  };

  push(to, sender);
  if (all) {
    (message?.to || []).forEach((a) => push(to, a));
    (message?.cc || []).forEach((a) => push(cc, a));
  }
  return { to, cc };
}
