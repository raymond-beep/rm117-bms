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

// Email HTML assumes a white page and a document width. The app is themed
// (including dark) and the body renders in a sandboxed frame with no stylesheet
// of its own, so it gets a minimal one.
//
// ⭐ The injected script is what lets the frame AUTO-SIZE. A fixed-height frame
// gave every long email its own inner scrollbar nested inside the reader pane —
// two scrollbars fighting, and the message visibly cut off. A cross-document
// frame cannot be measured from outside, so it measures itself and posts the
// height out. `token` ties each message to its own frame so one message can't
// resize another.
//
// It also intercepts link clicks and posts the URL to the parent instead of
// navigating. That is deliberate: it means the frame needs NO popup permission
// at all, so `sandbox="allow-scripts"` alone is enough — the frame gets an
// opaque origin with no access to the app's DOM, cookies or storage, and cannot
// open a window by itself. The parent decides what to open.
export function wrapEmailHtml(bodyHtml, token = 'mail') {
  const t = JSON.stringify(String(token));
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:12px;background:#fff;color:#111;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    word-wrap:break-word;overflow-wrap:break-word;}
  html,body{height:auto;overflow:hidden;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  blockquote{margin:8px 0 8px 12px;padding-left:12px;border-left:3px solid #ddd;color:#555;}
  a{color:#0b57d0;}
  pre{white-space:pre-wrap;word-wrap:break-word;}
</style></head><body>${bodyHtml}
<script>(function(){
  var token=${t}, last=0;
  function send(){
    var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)+8;
    if(h!==last){last=h;parent.postMessage({source:'rm117-mail',token:token,height:h},'*');}
  }
  send();
  window.addEventListener('load',send);
  window.addEventListener('resize',send);
  // Images and remote fonts land after first paint and change the height.
  if(window.ResizeObserver){new ResizeObserver(send).observe(document.body);}
  setTimeout(send,80);setTimeout(send,400);setTimeout(send,1500);
  // Links open via the parent — the frame itself has no popup permission.
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(!a)return;
    e.preventDefault();
    parent.postMessage({source:'rm117-mail',token:token,link:a.getAttribute('href')},'*');
  });
})();</script>
</body></html>`;
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
