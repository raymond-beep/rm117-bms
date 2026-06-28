// Shared formatting for generated documents (building-dept letters, proposals).
// Pure + unit-tested — the document components import these.

// Format a date-only string ('YYYY-MM-DD') as "January 26, 2026" in local time
// (no TZ shift — same approach as fmtDateOnly but with the full month name, which
// is the house style on RM117 letters/proposals).
export function longDateOnly(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '';
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Today as a local 'YYYY-MM-DD' (for date-input defaults; avoids the UTC shift
// of toISOString()).
export function todayIso() {
  const n = new Date();
  const mm = String(n.getMonth() + 1).padStart(2, '0');
  const dd = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${mm}-${dd}`;
}

// 'YYYY-MM-DD' → "1/27/2026" (no leading zeros) — the proposal footer style.
export function numericDate(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '';
  return `${m}/${day}/${y}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', ' Thousand', ' Million', ' Billion'];

function under1000(n) {
  let s = '';
  if (n >= 100) { s += `${ONES[Math.floor(n / 100)]} Hundred`; n %= 100; if (n) s += ' '; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += `-${ONES[n % 10]}`; }
  else if (n > 0) s += ONES[n];
  return s;
}

// Whole-dollar amount → "Eleven Thousand Five Hundred Dollars" (matches the
// proposal fee wording). Cents, if any, append " and NN/100".
export function dollarsToWords(amount) {
  const num = Number(amount) || 0;
  const cents = Math.round((Math.abs(num) - Math.floor(Math.abs(num))) * 100);
  let n = Math.floor(Math.abs(num));
  if (n === 0 && !cents) return 'Zero Dollars';
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  let words = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    words += (words ? ' ' : '') + under1000(groups[i]) + SCALES[i];
  }
  words = words || 'Zero';
  let out = `${words} Dollars`;
  if (cents) out += ` and ${String(cents).padStart(2, '0')}/100`;
  return out;
}

// Greedy word-wrap to a max width. `measure(str)` returns the rendered width of
// a string (e.g. font.widthOfTextAtSize) — injected so this stays pure/testable.
// A single word wider than maxWidth is kept on its own line (not split).
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let cur = '';
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (!cur || measure(candidate) <= maxWidth) cur = candidate;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

// Turn a free-text letter body into rendered blocks. Lines beginning with "-" or
// "•" group into a bullet list; blank lines break a group; everything else is a
// paragraph. Matches the RM117 letter style (a few bullets + a closing paragraph).
export function parseBodyBlocks(text) {
  const blocks = [];
  let bullets = null;
  for (const raw of (text || '').split('\n')) {
    const m = raw.match(/^\s*[-•]\s+(.*\S)\s*$/);
    if (m) {
      if (!bullets) { bullets = { type: 'bullets', items: [] }; blocks.push(bullets); }
      bullets.items.push(m[1]);
    } else if (raw.trim() === '') {
      bullets = null;
    } else {
      bullets = null;
      blocks.push({ type: 'para', text: raw.trim() });
    }
  }
  return blocks;
}
