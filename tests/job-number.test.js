import { describe, it, expect } from 'vitest';
import { JOB_ID_RE, isPlaceholderJobId, UNNUMBERED_PHASES, PHASES } from '../api/_lib/db.js';
import { parsePlaceholder, maxNumberForYear, officialJobId } from '../api/_lib/job-number.js';
import {
  JOB_ID_RE as CLIENT_RE,
  isPlaceholderJobId as clientIsPlaceholder,
  validateJobId,
  buildJobId,
} from '../src/lib/job-id.js';

describe('placeholder Job IDs (a lead has no number until the proposal is signed)', () => {
  it('accepts the placeholder form', () => {
    expect(JOB_ID_RE.test('26_xxx_Smith')).toBe(true);
    expect(JOB_ID_RE.test('26_xxx_FF_Smith')).toBe(true);
    expect(JOB_ID_RE.test('26_xxx_Costello_77 Benjamin St')).toBe(true);
  });

  it('still accepts real ids, and still rejects junk', () => {
    expect(JOB_ID_RE.test('26_043_Smith')).toBe(true);
    expect(JOB_ID_RE.test('26_43_Smith')).toBe(false);   // number must be 3 digits
    expect(JOB_ID_RE.test('26_yyy_Smith')).toBe(false);  // only `xxx` is the placeholder
    expect(JOB_ID_RE.test('26_xxx_')).toBe(false);       // name required
    expect(JOB_ID_RE.test('2026_xxx_Smith')).toBe(false);
  });

  it('identifies placeholders', () => {
    expect(isPlaceholderJobId('26_xxx_Smith')).toBe(true);
    expect(isPlaceholderJobId('26_043_Smith')).toBe(false);
    expect(isPlaceholderJobId(null)).toBe(false);
    expect(isPlaceholderJobId('')).toBe(false);
  });

  it('the client mirror of the regex/helper agrees with the server', () => {
    for (const id of ['26_xxx_Smith', '26_043_Smith', '26_43_Smith', '26_yyy_Smith']) {
      expect(CLIENT_RE.test(id), id).toBe(JOB_ID_RE.test(id));
      expect(clientIsPlaceholder(id), id).toBe(isPlaceholderJobId(id));
    }
  });

  it('a placeholder id passes the New Job builder validation', () => {
    expect(buildJobId({ yy: '26', nnn: 'xxx', forefront: false, name: 'Smith' })).toBe('26_xxx_Smith');
    expect(validateJobId('26_xxx_Smith', []).valid).toBe(true);
    // …but not if that exact lead already exists (two Smiths need distinguishing).
    expect(validateJobId('26_xxx_Smith', ['26_xxx_Smith'])).toEqual({ valid: false, reason: 'duplicate' });
  });

  it('the un-numbered phases are the ones where a job is not yet won', () => {
    expect(UNNUMBERED_PHASES).toEqual(['lead', 'potential', 'job_dropped']);
    for (const p of UNNUMBERED_PHASES) expect(PHASES).toContain(p);
    // Moving into any of these does NOT earn a number; anything else does.
    expect(UNNUMBERED_PHASES).not.toContain('survey_zoning');
  });
});

describe('parsePlaceholder', () => {
  it('splits a placeholder into its parts', () => {
    expect(parsePlaceholder('26_xxx_Smith')).toEqual({ yy: '26', num: 'xxx', ff: '', name: 'Smith' });
  });

  it('keeps the Forefront marker', () => {
    expect(parsePlaceholder('26_xxx_FF_Smith')).toEqual({ yy: '26', num: 'xxx', ff: 'FF_', name: 'Smith' });
  });

  it('keeps a name with extra qualifiers (spaces and underscores)', () => {
    expect(parsePlaceholder('25_xxx_Costello_77 Benjamin St').name).toBe('Costello_77 Benjamin St');
  });

  it('returns null for a real id', () => {
    expect(parsePlaceholder('26_043_Smith')).toBeNull();
    expect(parsePlaceholder(null)).toBeNull();
  });
});

describe('maxNumberForYear', () => {
  const ids = ['26_001_A', '26_042_B', '25_099_C', '26_xxx_D', 'junk', null];

  it('finds the highest number used in that year', () => {
    expect(maxNumberForYear(ids, '26')).toBe(42);
  });

  it('ignores other years, placeholders and junk', () => {
    expect(maxNumberForYear(ids, '25')).toBe(99);
    expect(maxNumberForYear(ids, '24')).toBe(0); // none yet
    expect(maxNumberForYear([], '26')).toBe(0);
  });

  it('a year of nothing but leads has no numbers taken', () => {
    expect(maxNumberForYear(['26_xxx_A', '26_xxx_B'], '26')).toBe(0);
  });
});

describe('officialJobId', () => {
  it('pads to three digits and preserves FF + name', () => {
    expect(officialJobId({ yy: '26', ff: '', name: 'Smith' }, 43)).toBe('26_043_Smith');
    expect(officialJobId({ yy: '26', ff: 'FF_', name: 'Smith' }, 7)).toBe('26_007_FF_Smith');
    expect(officialJobId({ yy: '26', ff: '', name: 'Costello_77 Benjamin St' }, 120))
      .toBe('26_120_Costello_77 Benjamin St');
  });

  it('produces an id the format accepts', () => {
    const id = officialJobId(parsePlaceholder('26_xxx_FF_Smith'), 43);
    expect(id).toBe('26_043_FF_Smith');
    expect(JOB_ID_RE.test(id)).toBe(true);
    expect(isPlaceholderJobId(id)).toBe(false);
  });
});
