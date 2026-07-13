import { describe, it, expect } from 'vitest';
import { addressLine } from '../src/lib/format.js';

describe('addressLine', () => {
  it('joins a stored mailing block into one line', () => {
    // The real shape of ~110 of the 117 addresses imported from the Sheet.
    expect(addressLine('1 Knapp Ave\nFlorham Park, NJ 07932')).toBe('1 Knapp Ave, Florham Park, NJ 07932');
  });

  it('is the fix for the jammed-together bug in a single-line input', () => {
    // A raw <input value> drops the \n outright → "204 Robinhood RoadMountainside".
    expect(addressLine('204 Robinhood Road\nMountainside')).toBe('204 Robinhood Road, Mountainside');
  });

  it('collapses blank lines rather than emitting an empty segment', () => {
    expect(addressLine('554 HARRISON STREET\n\nRAHWAY, NJ 07065')).toBe('554 HARRISON STREET, RAHWAY, NJ 07065');
  });

  it('leaves an already-single-line address alone', () => {
    expect(addressLine('12 Main St, Roselle Park, NJ')).toBe('12 Main St, Roselle Park, NJ');
  });

  it('returns an empty string for empty input', () => {
    expect(addressLine(null)).toBe('');
    expect(addressLine(undefined)).toBe('');
    expect(addressLine('')).toBe('');
  });
});
