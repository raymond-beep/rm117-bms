import { describe, it, expect } from 'vitest';
import { escapeQboQueryValue } from '../api/_lib/qbo.js';

// Intuit's query language escapes a literal single quote with a backslash (\'),
// NOT by ANSI-SQL doubling (''). Doubling was a real bug: a name like
// 24_081_O'Bagel_Montclair produced `'...O''Bagel...'`, which Intuit's parser read
// as two adjacent string literals and rejected with a 400 "Error parsing query".
describe('escapeQboQueryValue', () => {
  it('escapes a single quote with a backslash, not by doubling', () => {
    expect(escapeQboQueryValue("O'Bagel")).toBe("O\\'Bagel");
    expect(escapeQboQueryValue("25_085_O'Bagel_Montclair")).toBe("25_085_O\\'Bagel_Montclair");
  });

  it('leaves quote-free values untouched', () => {
    expect(escapeQboQueryValue('25_004_FF_Warmington')).toBe('25_004_FF_Warmington');
    expect(escapeQboQueryValue('2026-07-18')).toBe('2026-07-18');
  });

  it('escapes backslashes before quotes so the escaping is unambiguous', () => {
    expect(escapeQboQueryValue("a\\b")).toBe("a\\\\b");
    expect(escapeQboQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it('coerces non-strings without throwing', () => {
    expect(escapeQboQueryValue(123)).toBe('123');
  });
});
