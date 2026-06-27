// Document formatting helpers for the letter/proposal generators.
import { describe, it, expect } from 'vitest';
import { longDateOnly, todayIso, parseBodyBlocks } from '../src/lib/doc-format.js';

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
