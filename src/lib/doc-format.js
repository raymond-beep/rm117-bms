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
