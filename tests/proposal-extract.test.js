import { describe, it, expect } from 'vitest';
import { normalize } from '../api/_lib/proposal-extract.js';
import { isValidSubPhase } from '../api/_lib/db.js';
import { subPhasesFor } from '../src/lib/format.js';

// normalize() is the boundary between an LLM and a DB column with a CHECK constraint
// (design_phase_count must be 1–3). The JSON schema already constrains the model — these
// tests cover the "what if it doesn't" case, because that's the one that corrupts data.
describe('normalize (the guard between the model and the database)', () => {
  it('passes a clean answer through', () => {
    expect(normalize({ design_phase_count: 2, evidence: 'DPI and DPII', confidence: 'high' }))
      .toEqual({ design_phase_count: 2, evidence: 'DPI and DPII', confidence: 'high' });
  });

  it('keeps "the proposal does not say" as a real answer', () => {
    // Abstaining must survive — if null got coerced to a number we would silently invent
    // a design ladder the client never bought.
    expect(normalize({ design_phase_count: null, evidence: '', confidence: 'low' }).design_phase_count).toBeNull();
  });

  it('rejects a count the database would refuse', () => {
    for (const bad of [0, 4, 99, -1, 2.5, '2', true, undefined, NaN]) {
      expect(normalize({ design_phase_count: bad }).design_phase_count, String(bad)).toBeNull();
    }
  });

  it('never lets an out-of-range count reach the phase ladder', () => {
    // The UI caps the sub-phase list by this number — a 9 would offer a DPIV that has no
    // label, no DB value, and no meaning.
    const count = normalize({ design_phase_count: 9 }).design_phase_count;
    expect(subPhasesFor({ phase: 'design_phase', design_phase_count: count }))
      .toEqual(['dp1', 'dp2', 'dp3']); // falls back to the full set, not an invented one
  });

  it('every count it can emit maps to a valid sub-phase', () => {
    for (const n of [1, 2, 3]) {
      const subs = subPhasesFor({ phase: 'design_phase', design_phase_count: n });
      expect(subs).toHaveLength(n);
      for (const s of subs) expect(isValidSubPhase('design_phase', s)).toBe(true);
    }
  });

  it('defaults confidence to low rather than trusting a junk value', () => {
    expect(normalize({ design_phase_count: 2, confidence: 'extremely sure' }).confidence).toBe('low');
    expect(normalize({ design_phase_count: 2 }).confidence).toBe('low');
  });

  it('caps the evidence quote and survives a non-string', () => {
    expect(normalize({ design_phase_count: 1, evidence: 'x'.repeat(900) }).evidence).toHaveLength(500);
    expect(normalize({ design_phase_count: 1, evidence: { nope: 1 } }).evidence).toBe('');
  });

  it('survives junk input entirely', () => {
    for (const junk of [null, undefined, {}, 'nope', 42]) {
      expect(normalize(junk)).toEqual({ design_phase_count: null, evidence: '', confidence: 'low' });
    }
  });
});
