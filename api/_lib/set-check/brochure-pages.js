// Which pages of a window brochure are worth sending to the AI. Pure (no pdf/db/AI)
// so the page-selection rules are unit-tested — the messy part, reading a text layer
// out of a PDF, lives in the caller; this module only judges the text it is handed.
//
// WHY this exists (SET_CHECK.md, Phase 3a): a vendor catalog is ~280 pages and mostly
// marketing. The two things we actually check windows against live on a handful of
// pages — the SIZE tables (frame / rough-opening dimensions keyed to the manufacturer's
// call number, e.g. Andersen TW2842) and the NFRC PERFORMANCE tables (U-Factor / SHGC
// by glazing package, Andersen 400 pp. 201-206). Reading the whole catalog costs ~$2.40
// and ~2.5 min per run; reading the right ~40 pages is ~$0.35 and fast.
//
// The bias is deliberate and one-directional: an extra page costs a fraction of a cent,
// a MISSING page produces a wrong answer (a size that is really offered reads as "not
// found" and flags a window that is fine). So we over-include — low keep threshold, and
// we pull in the immediate neighbours of every strong page, because a size table spills
// across pages and a table's header can sit on the page before its data. And, like
// everything in Set Check, this only SUGGESTS: staff see the chosen pages and confirm
// before the brochure goes into service. A wrong guess here costs a click, never a
// wrong answer.

// Vocabulary that marks the pages we need. Presence-based, case-insensitive; each hit
// adds its weight once (a page that merely NAMES "U-Factor" in prose should not outrank
// a real table — density signals below do the ranking).
const SIGNALS = [
  // NFRC performance table — the U-factor source.
  [/\bNFRC\b/i, 5, 'NFRC'],
  [/\bU-?\s?Factors?\b/i, 4, 'U-Factor'],
  [/\bU-?\s?Values?\b/i, 4, 'U-Value'],
  [/\bSHGC\b/i, 3, 'SHGC'],
  [/\bVisible\s+Transmittance\b|\bVT\b/i, 2, 'Visible Transmittance'],
  [/\bLow-?E\b|\bglazing\b|\bglass\s+package\b/i, 2, 'glazing'],
  [/\bCondensation\s+Resistance\b|\bCR\b/i, 1, 'Condensation Resistance'],
  // Size table — the size source.
  [/\bRough\s+Opening(s)?\b|\bR\.?O\.?\b/i, 3, 'Rough Opening'],
  [/\bUnit\s+(Dimension|Size)s?\b/i, 3, 'Unit Dimension'],
  [/\bFrame\s+(Dimension|Size|Width|Height)s?\b/i, 2, 'Frame Dimension'],
  [/\bSash\s+Opening\b/i, 1, 'Sash Opening'],
];

// The manufacturer's call number (Andersen TW2842, CW135, C235, A31 …): 1-3 leading
// letters then 2-4 digits. This is the STRONGEST size-table signal — a page dense with
// these is a size grid, whatever its headers say. Kept deliberately loose because codes
// vary by maker; the density requirement (need several, not one) filters stray matches
// like a figure reference "Fig12".
const CALL_NUMBER_RE = /\b[A-Z]{1,3}\d{2,4}\b/g;

// A U-factor / SHGC value: a decimal in the 0.xx performance range. A page full of
// these is a performance table, again regardless of its prose.
const PERF_VALUE_RE = /\b0?\.[0-9]{2}\b/g;

// Cap each density signal so one very long table can't drown out everything else, and
// so a keep decision never hinges on a single page scoring astronomically.
const CALL_NUMBER_CAP = 6; // +1 per code, up to +6
const PERF_VALUE_CAP = 4; // +0.5 per value, up to +4

// A page at or above this score is kept on its own merits. Set low on purpose — the
// neighbour rule and the one-directional bias mean the cost of a false keep is trivial.
export const KEEP_THRESHOLD = 4;

// Score one page's text. Returns { score, reasons } — reasons drive the staff-confirm
// UI ("kept: NFRC, U-Factor, 11 size codes") so a person can eyeball the pick.
export function scorePage(text) {
  const t = String(text || '');
  if (!t.trim()) return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];

  for (const [re, weight, label] of SIGNALS) {
    if (re.test(t)) {
      score += weight;
      reasons.push(label);
    }
  }

  const codes = (t.match(CALL_NUMBER_RE) || []).length;
  if (codes >= 3) {
    score += Math.min(codes, CALL_NUMBER_CAP);
    reasons.push(`${codes} size codes`);
  }

  const values = (t.match(PERF_VALUE_RE) || []).length;
  if (values >= 4) {
    score += Math.min(values * 0.5, PERF_VALUE_CAP);
    reasons.push(`${values} performance values`);
  }

  return { score, reasons };
}

// Choose which pages of a brochure to send to the AI.
//
//   pageTexts — array of per-page text, in order. Index i is PDF page (i + 1).
//   opts.threshold — override KEEP_THRESHOLD (tests / tuning).
//   opts.neighbours — how many pages either side of a strong page to pull in (default 1).
//
// Returns:
//   { pages, keep, scanned }
//   pages   — every page's { page (1-based), score, reasons, kept }, for the confirm UI.
//   keep    — the 1-based page numbers to extract, ascending (what pdf-lib trims to).
//   scanned — total pages seen (so the caller can report "40 of 284 pages").
//
// If NOTHING clears the threshold the page had no usable text layer (a scanned catalog),
// keep is empty and the caller must fall back to the full document via the Files API —
// guessing a page range on a text-less scan is exactly the silent failure Phase 3a
// exists to avoid.
export function selectPages(pageTexts = [], opts = {}) {
  const threshold = opts.threshold ?? KEEP_THRESHOLD;
  const neighbours = opts.neighbours ?? 1;

  const pages = pageTexts.map((text, i) => {
    const { score, reasons } = scorePage(text);
    return { page: i + 1, score, reasons, kept: false };
  });

  // First pass: pages that clear the threshold on their own.
  const strong = new Set();
  for (const p of pages) {
    if (p.score >= threshold) strong.add(p.page);
  }

  // Second pass: over-include neighbours of every strong page. A neighbour is kept
  // because a table spans pages, so its score/reasons stay as measured — the UI can
  // show it was pulled in as context, not on its own signal.
  const keepSet = new Set(strong);
  for (const page of strong) {
    for (let d = 1; d <= neighbours; d++) {
      if (page - d >= 1) keepSet.add(page - d);
      if (page + d <= pages.length) keepSet.add(page + d);
    }
  }

  for (const p of pages) {
    if (keepSet.has(p.page)) p.kept = true;
  }

  const keep = [...keepSet].sort((a, b) => a - b);
  return { pages, keep, scanned: pages.length };
}
