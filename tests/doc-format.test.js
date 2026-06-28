// Document formatting helpers for the letter/proposal generators.
import { describe, it, expect } from 'vitest';
import { longDateOnly, todayIso, parseBodyBlocks, wrapText } from '../src/lib/doc-format.js';

// Fake measurer: every character is 1 unit wide (incl. spaces) — lets us assert
// wrapping deterministically without a real font.
const charWidth = (s) => s.length;

describe('longDateOnly (house style: "January 26, 2026")', () => {
  it('formats a YYYY-MM-DD date in local time with full month', () => {
    expect(longDateOnly('2026-01-26')).toBe('January 26, 2026');
    expect(longDateOnly('2026-06-04')).toBe('June 4, 2026');
  });
  it('does not shift the day across a timezone (bare date is local, not UTC)', () => {
    expect(longDateOnly('2026-03-01')).toBe('March 1, 2026');
  });
  it('returns empty string for falsy / malformed input', () => {
    expect(longDateOnly('')).toBe('');
    expect(longDateOnly(null)).toBe('');
    expect(longDateOnly('nope')).toBe('');
  });
});

describe('todayIso', () => {
  it('returns a local YYYY-MM-DD string', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseBodyBlocks (letter body → bullets + paragraphs)', () => {
  it('groups consecutive dash/bullet lines into one bullet block', () => {
    const blocks = parseBodyBlocks('- First item\n- Second item');
    expect(blocks).toEqual([{ type: 'bullets', items: ['First item', 'Second item'] }]);
  });

  it('treats non-bullet lines as paragraphs', () => {
    const blocks = parseBodyBlocks('Furthermore, framing revisions are attached.');
    expect(blocks).toEqual([{ type: 'para', text: 'Furthermore, framing revisions are attached.' }]);
  });

  it('handles bullets followed by a paragraph (the common letter shape)', () => {
    const blocks = parseBodyBlocks('- Reinforce with triple posts\n- Verify in field\n\nThese methods are fine with me.');
    expect(blocks).toEqual([
      { type: 'bullets', items: ['Reinforce with triple posts', 'Verify in field'] },
      { type: 'para', text: 'These methods are fine with me.' },
    ]);
  });

  it('accepts • as a bullet marker and ignores blank lines', () => {
    const blocks = parseBodyBlocks('• Only item\n\n');
    expect(blocks).toEqual([{ type: 'bullets', items: ['Only item'] }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseBodyBlocks('')).toEqual([]);
    expect(parseBodyBlocks(null)).toEqual([]);
  });
});

describe('wrapText (greedy word wrap for the PDF body)', () => {
  it('wraps words to the max width', () => {
    // width 10: "aaa bbb" = 7 fits; adding " ccc" = 11 > 10 → wrap
    expect(wrapText('aaa bbb ccc', 10, charWidth)).toEqual(['aaa bbb', 'ccc']);
  });

  it('keeps an over-long single word on its own line (no mid-word split)', () => {
    expect(wrapText('supercalifragilistic', 5, charWidth)).toEqual(['supercalifragilistic']);
  });

  it('preserves explicit newlines as separate paragraphs (blank line kept)', () => {
    expect(wrapText('one\n\ntwo', 100, charWidth)).toEqual(['one', '', 'two']);
  });

  it('handles empty / nullish input', () => {
    expect(wrapText('', 10, charWidth)).toEqual(['']);
    expect(wrapText(null, 10, charWidth)).toEqual(['']);
  });
});
