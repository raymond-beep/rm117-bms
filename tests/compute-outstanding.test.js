// Money math + Job ID invariant — the cheapest insurance against a silent
// regression in the one number Ang reads every day (outstanding A/R).
import { describe, it, expect } from 'vitest';
import { computeOutstanding, JOB_ID_RE } from '../api/_lib/db.js';

describe('computeOutstanding (outstanding = job_total - sum(payments))', () => {
  it('subtracts the sum of payments from job_total', () => {
    const job = { job_total: 10000 };
    const payments = [{ amount: 800 }, { amount: 1400 }, { amount: 1400 }];
    expect(computeOutstanding(job, payments)).toBe(6400);
  });

  it('returns the full total when there are no payments', () => {
    expect(computeOutstanding({ job_total: 5000 }, [])).toBe(5000);
    expect(computeOutstanding({ job_total: 5000 }, undefined)).toBe(5000);
    expect(computeOutstanding({ job_total: 5000 }, null)).toBe(5000);
  });

  it('treats a missing job_total as 0', () => {
    expect(computeOutstanding({}, [{ amount: 100 }])).toBe(-100);
  });

  it('coerces string amounts (Supabase numerics arrive as strings)', () => {
    const job = { job_total: '5000' };
    const payments = [{ amount: '800' }, { amount: '1200' }];
    expect(computeOutstanding(job, payments)).toBe(3000);
  });

  it('ignores null/undefined payment amounts without going NaN', () => {
    const payments = [{ amount: 1000 }, { amount: null }, {}];
    expect(computeOutstanding({ job_total: 1500 }, payments)).toBe(500);
  });

  it('can go negative when a job is overpaid', () => {
    expect(computeOutstanding({ job_total: 1000 }, [{ amount: 1200 }])).toBe(-200);
  });
});

describe('JOB_ID_RE — Job ID must match the QBO Customer Display Name format', () => {
  it('accepts standard and Forefront job ids', () => {
    expect(JOB_ID_RE.test('26_011_Kuhn')).toBe(true);
    expect(JOB_ID_RE.test('25_054_Malanga_Subdivide')).toBe(true);
    expect(JOB_ID_RE.test('26_032_FF_Williams')).toBe(true);
  });

  it('accepts ids with internal spaces (real Job IDs / QBO names have them)', () => {
    expect(JOB_ID_RE.test('26_011_Kuhn_352 Amherst')).toBe(true);
    expect(JOB_ID_RE.test('26_030_Rodriguez_1 Knapp Ave')).toBe(true);
    expect(JOB_ID_RE.test('24_008_Dunn Fritchey')).toBe(true);
    expect(JOB_ID_RE.test('24_074_Madden_Mantoloking*')).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(JOB_ID_RE.test('2_11_Kuhn')).toBe(false);    // year/number wrong width
    expect(JOB_ID_RE.test('26-011-Kuhn')).toBe(false);  // wrong separators
    expect(JOB_ID_RE.test('Kuhn')).toBe(false);         // no id prefix
    expect(JOB_ID_RE.test('')).toBe(false);
    expect(JOB_ID_RE.test('26_030_ Knapp')).toBe(false); // leading space in name
    expect(JOB_ID_RE.test('26_030_Knapp ')).toBe(false); // trailing space
  });
});
