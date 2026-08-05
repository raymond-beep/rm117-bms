import { describe, it, expect } from 'vitest';
import { normalizeSummary } from '../api/_lib/proposal-summary.js';

// normalizeSummary() is the boundary between the model and a CONTRACT document. The JSON
// schema already constrains the shape; these cover what lands wrong in the textarea when it
// doesn't — and, most importantly, that "I can't write this" survives as a real answer.
describe('normalizeSummary (the guard between the model and the proposal PDF)', () => {
  it('passes a clean draft through', () => {
    expect(normalizeSummary({ summary: 'The existing house will be renovated.', missing: '' }))
      .toEqual({ summary: 'The existing house will be renovated.', missing: '' });
  });

  it('keeps a numbered list intact', () => {
    // Newlines are load-bearing: wrapText() splits on them, so this is what puts each
    // numbered item on its own line in the PDF. Collapsing them would silently produce a
    // run-on paragraph that still *looks* like valid output.
    const list = '1. There will be a dormer installed above the existing garage.\n2. The dormer will be integrated with the existing bedroom.';
    expect(normalizeSummary({ summary: list, missing: '' }).summary).toBe(list);
  });

  it('keeps "the brief is too thin" as a real answer', () => {
    // If an abstention got coerced into a string, the generator would paste empty or
    // placeholder text into a contract instead of asking for more detail.
    const out = normalizeSummary({ summary: null, missing: 'which floor the addition is on' });
    expect(out.summary).toBeNull();
    expect(out.missing).toBe('which floor the addition is on');
  });

  it('treats a whitespace-only draft as an abstention', () => {
    for (const blank of ['', '   ', '\n\n']) {
      expect(normalizeSummary({ summary: blank, missing: '' }).summary, JSON.stringify(blank)).toBeNull();
    }
  });

  it('strips a heading the model added itself', () => {
    // The template already prints "PROJECT SUMMARY"; a second one inside the body would
    // render as literal text in the middle of the proposal.
    expect(normalizeSummary({ summary: 'PROJECT SUMMARY\nThe existing house will be renovated.', missing: '' }).summary)
      .toBe('The existing house will be renovated.');
    expect(normalizeSummary({ summary: 'Project Summary: The garage will be extended.', missing: '' }).summary)
      .toBe('The garage will be extended.');
  });

  it('trims surrounding whitespace that would shift the PDF block', () => {
    expect(normalizeSummary({ summary: '\n  The garage will be extended.  \n', missing: '' }).summary)
      .toBe('The garage will be extended.');
  });

  it('repairs the over-escaping the Opus family intermittently emits', () => {
    // Observed live: an em dash came back as the literal characters — and punctuation
    // came back backslash-prefixed. Once in three identical runs — so it must be handled,
    // not hoped away. Untreated it renders as garbage inside a client-facing proposal.
    const mangled = 'What is being renovated \\(kitchen, bathroom\\) \\u2014 the brief only says "reno".';
    expect(normalizeSummary({ summary: null, missing: mangled }).missing)
      .toBe('What is being renovated (kitchen, bathroom) — the brief only says "reno".');
  });

  it('repairs escape artifacts in the summary itself', () => {
    // A project summary has no legitimate backslash, so stripping them can only remove the
    // artifact — and this text goes into a signed contract.
    expect(normalizeSummary({ summary: 'The garage \\(2 car\\) will be extended \\u2014 rear only.', missing: '' }).summary)
      .toBe('The garage (2 car) will be extended — rear only.');
  });

  it('leaves ordinary punctuation and numerals alone', () => {
    // The house style leans on parenthesised numerals — (6) beds, (5-1/2) baths. Those must
    // survive untouched, or the repair above would be worse than the bug.
    const clean = 'The house will have (6) beds, (5-1/2) baths, and various living spaces.';
    expect(normalizeSummary({ summary: clean, missing: '' }).summary).toBe(clean);
  });

  it('survives junk in either field', () => {
    for (const junk of [undefined, null, {}, { summary: 42 }, { summary: [] }]) {
      const out = normalizeSummary(junk);
      expect(out.summary, JSON.stringify(junk)).toBeNull();
      expect(typeof out.missing).toBe('string');
    }
  });
});
