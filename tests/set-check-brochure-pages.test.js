// Which pages of a vendor window brochure to send to the AI. The page snippets here
// are modelled on the real Andersen 400 Series catalog (SET_CHECK.md, Phase 3a): the
// SIZE tables key dimensions to call numbers (TW2842), the NFRC PERFORMANCE tables give
// U-Factor / SHGC by glazing, and the bulk of the book is marketing prose.
import { describe, it, expect } from 'vitest';
import { scorePage, selectPages, KEEP_THRESHOLD } from '../api/_lib/set-check/brochure-pages.js';

// A realistic NFRC performance page: the U-factor source, pp. 201-206 in the 400 book.
const NFRC_PAGE = `
400 Series Tilt-Wash Double-Hung — NFRC Certified Performance
Glazing            U-Factor   SHGC   VT     CR
Low-E4             0.30       0.28   0.51   50
Low-E4 SmartSun    0.27       0.21   0.48   51
Low-E4 Sun         0.28       0.19   0.46   50
High-Performance   0.25       0.26   0.49   55
`;

// A realistic size page: the size source. Call numbers + rough opening dimensions.
const SIZE_PAGE = `
Tilt-Wash Double-Hung  Unit Dimensions and Rough Openings
Call No.   Unit Width   Unit Height   Rough Opening W   Rough Opening H
TW2032     2'-0 1/8"    3'-4 7/8"     2'-0 5/8"         3'-5 3/8"
TW2842     2'-8 1/8"    4'-4 7/8"     2'-8 5/8"         4'-5 3/8"
TW3042     3'-0 1/8"    4'-4 7/8"     3'-0 5/8"         4'-5 3/8"
TW3452     3'-4 1/8"    5'-4 7/8"     3'-4 5/8"         5'-5 3/8"
`;

// A marketing spread — the kind of page the whole exercise exists to skip.
const MARKETING_PAGE = `
Bring the outside in. Andersen 400 Series windows pair timeless craftsmanship
with the low-maintenance performance homeowners love. Explore rich interior
finishes and let natural light transform every room of your home.
`;

describe('scorePage', () => {
  it('scores an NFRC performance page well above the keep threshold', () => {
    expect(scorePage(NFRC_PAGE).score).toBeGreaterThan(KEEP_THRESHOLD);
  });

  it('scores a size table well above the keep threshold', () => {
    expect(scorePage(SIZE_PAGE).score).toBeGreaterThan(KEEP_THRESHOLD);
  });

  it('scores a marketing spread below the keep threshold', () => {
    expect(scorePage(MARKETING_PAGE).score).toBeLessThan(KEEP_THRESHOLD);
  });

  it('scores empty / whitespace text as zero (a text-less scanned page)', () => {
    expect(scorePage('').score).toBe(0);
    expect(scorePage('   \n  ').score).toBe(0);
    expect(scorePage(null).score).toBe(0);
  });

  it('reports WHY a page was kept, for the staff-confirm UI', () => {
    const { reasons } = scorePage(NFRC_PAGE);
    expect(reasons).toContain('NFRC');
    expect(reasons).toContain('U-Factor');
    expect(reasons).toContain('SHGC');
  });

  it('counts a dense run of call numbers as the size-table signal', () => {
    const { reasons } = scorePage(SIZE_PAGE);
    expect(reasons.some((r) => /size codes/.test(r))).toBe(true);
  });

  it('does not treat a single stray code as a size table', () => {
    // One figure reference in prose is not a size grid.
    const { reasons } = scorePage('See Fig12 for the sightline detail on this unit.');
    expect(reasons.some((r) => /size codes/.test(r))).toBe(false);
  });

  it('matches U-Factor however it is spelled or spaced', () => {
    for (const s of ['U-Factor', 'U Factor', 'UFactor', 'U-factors', 'U Value', 'U-Values']) {
      expect(scorePage(`Performance ${s} 0.30`).score, s).toBeGreaterThan(0);
    }
  });
});

describe('selectPages', () => {
  // A miniature catalog: prose, prose, SIZE, NFRC, prose.
  const catalog = [MARKETING_PAGE, MARKETING_PAGE, SIZE_PAGE, NFRC_PAGE, MARKETING_PAGE];

  it('keeps the size and performance pages and drops the marketing', () => {
    const { keep } = selectPages(catalog);
    expect(keep).toContain(3); // size table
    expect(keep).toContain(4); // NFRC table
  });

  it('over-includes the immediate neighbours of a strong page', () => {
    // Pages 3 and 4 are strong, so 2 and 5 come along as spill-over context.
    const { keep } = selectPages(catalog);
    expect(keep).toContain(2);
    expect(keep).toContain(5);
  });

  it('reports every page as 1-based with its score and kept flag', () => {
    const { pages, scanned } = selectPages(catalog);
    expect(scanned).toBe(5);
    expect(pages[0].page).toBe(1);
    expect(pages[2].kept).toBe(true);
  });

  it('returns keep ascending with no duplicates when strong pages are adjacent', () => {
    const { keep } = selectPages(catalog);
    const sorted = [...keep].sort((a, b) => a - b);
    expect(keep).toEqual(sorted);
    expect(new Set(keep).size).toBe(keep.length);
  });

  it('keeps NOTHING when no page has a usable text layer (fall back to full doc)', () => {
    // A scanned catalog: every page comes back as empty text.
    const { keep } = selectPages(['', '', '', '']);
    expect(keep).toEqual([]);
  });

  it('does not run off the ends when a strong page sits at the edge', () => {
    const { keep } = selectPages([NFRC_PAGE, MARKETING_PAGE]);
    expect(keep).toContain(1);
    expect(keep).toContain(2); // neighbour to the right
    expect(Math.min(...keep)).toBe(1); // never a page 0
  });
});
