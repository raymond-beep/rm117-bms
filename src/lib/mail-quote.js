// Split a message into what was actually WRITTEN and what was merely carried
// along — the quoted history and the signature.
//
// Why this exists: every reply embeds the whole conversation so far. A 13-message
// thread means the last message physically contains the other 12, so reading a
// thread meant reading the same text thirteen times, each copy one level deeper.
// Mail clients hide this behind a "•••"; without it, a two-line reply renders as
// several screens.
//
// Nothing is deleted — the quoted part is returned separately so the UI can
// reveal it. Occasionally the chain holds something never restated (a spec, an
// address), and dropping it would mean going back to Gmail.

// Containers whose entire contents are quoted history. Ordered outermost-first;
// nested matches are discarded so a blockquote inside a gmail_quote isn't
// counted twice.
const QUOTE_SELECTORS = [
  '.gmail_quote',            // Gmail
  '.gmail_quote_container',
  'blockquote.gmail_quote',
  '.yahoo_quoted',           // Yahoo
  '.protonmail_quote',       // Proton
  '.zmail_extra',            // Zoho
  'blockquote[type="cite"]', // Apple Mail
  '#divRplyFwdMsg',          // Outlook: the "From: … Sent: …" header block
  '.moz-cite-prefix',        // Thunderbird
];

// Signature blocks. Deliberately CONSERVATIVE — only markers a client actually
// emits. Guessing "the last few lines look like contact details" would eventually
// eat a real sentence, and hiding something the sender wrote is far worse than
// leaving a signature on screen.
const SIGNATURE_SELECTORS = [
  '.gmail_signature',
  '[data-smartmail="gmail_signature"]',
  '#Signature',
  '#ms-outlook-mobile-signature',
  '.moz-signature',
];

// Outlook marks the boundary rather than wrapping: everything from this element
// onward is quoted, including its following siblings.
const BOUNDARY_SELECTORS = ['#appendonsend', '#divRplyFwdMsg', 'hr#stopSpelling'];

function isNested(node, others) {
  return others.some((o) => o !== node && o.contains(node));
}

// Split sanitised HTML into { visible, quoted }. Needs a DOM (browser, or
// happy-dom under test) — parsing the real tree is far more reliable than
// regexing nested blockquotes.
export function splitQuotedHtml(html) {
  if (!html) return { visible: '', quoted: '' };
  if (typeof DOMParser === 'undefined') return { visible: html, quoted: '' };

  const doc = new DOMParser().parseFromString(`<body><div id="__rm117">${html}</div></body>`, 'text/html');
  const root = doc.getElementById('__rm117');
  if (!root) return { visible: html, quoted: '' };

  const taken = [];

  // 1. Boundary markers: the element and everything after it at that level.
  for (const sel of BOUNDARY_SELECTORS) {
    const marker = root.querySelector(sel);
    if (!marker) continue;
    let node = marker;
    while (node) {
      const next = node.nextSibling;
      taken.push(node);
      node = next;
    }
    break;
  }

  // 2. Whole containers of quoted history + signature blocks.
  for (const sel of [...QUOTE_SELECTORS, ...SIGNATURE_SELECTORS]) {
    root.querySelectorAll(sel).forEach((n) => { if (!taken.includes(n)) taken.push(n); });
  }

  const outermost = taken.filter((n) => !isNested(n, taken));
  if (!outermost.length) return { visible: root.innerHTML, quoted: '' };

  // Preserve document order in the quoted output.
  outermost.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & 4) return -1; // a precedes b
    if (pos & 2) return 1;
    return 0;
  });

  const quoted = outermost
    .map((n) => (n.nodeType === 1 ? n.outerHTML : (n.textContent || '')))
    .join('');
  outermost.forEach((n) => n.parentNode && n.parentNode.removeChild(n));

  return { visible: root.innerHTML.trim(), quoted: quoted.trim() };
}

// Plain-text equivalent. Quoting in text has no markup, only conventions.
const TEXT_QUOTE_START = [
  /^\s*On .{0,200}wrote:\s*$/im,            // "On Tue, 28 Jul 2026 at 09:14, X wrote:"
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,                          // Outlook's underscore rule
  /^\s*From:\s.+$/im,                        // Outlook header block
  /^\s*Sent from my i(Phone|Pad)\s*$/im,
];
const TEXT_SIGNATURE = /^-- \s*$/m;

export function splitQuotedText(text) {
  if (!text) return { visible: '', quoted: '' };
  const s = String(text).replace(/\r\n/g, '\n');

  let cut = -1;
  for (const re of TEXT_QUOTE_START) {
    const m = s.match(re);
    if (m && m.index != null && (cut === -1 || m.index < cut)) cut = m.index;
  }

  // A run of ">" lines is quoting too — take the earliest one that starts a run.
  const lines = s.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*>/.test(lines[i])) {
      if (cut === -1 || offset < cut) cut = offset;
      break;
    }
    offset += lines[i].length + 1;
  }

  const sig = s.match(TEXT_SIGNATURE);
  if (sig && sig.index != null && (cut === -1 || sig.index < cut)) cut = sig.index;

  if (cut <= 0) return { visible: s.trim(), quoted: '' };
  return { visible: s.slice(0, cut).trim(), quoted: s.slice(cut).trim() };
}

// How many earlier replies are folded away — for the "••• 12 earlier replies"
// label. Counts quote openers, not messages, so it is a floor rather than exact.
export function countQuotedReplies(quoted) {
  if (!quoted) return 0;
  const text = String(quoted);
  const markers = text.match(/On .{0,200}wrote:|<div[^>]+class="[^"]*gmail_quote|From:\s/gi);
  return markers ? markers.length : 1;
}
