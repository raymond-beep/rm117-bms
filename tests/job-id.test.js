// New-job Job ID builder helpers — assembling and validating YY_NNN_[FF_]LastName
// (the QuickBooks Customer Display Name invariant) before a job is created.
import { describe, it, expect } from 'vitest';
import {
  currentYY, pad3, nextJobNumber, nextJobNumberAcross, buildJobId, validateJobId, JOB_ID_RE,
} from '../src/lib/job-id.js';

describe('currentYY', () => {
  it('returns the 2-digit year', () => {
    expect(currentYY(new Date('2026-03-01'))).toBe('26');
    expect(currentYY(new Date('2009-12-31'))).toBe('09'); // zero-padded
  });
});

describe('pad3', () => {
  it('pads to three digits', () => {
    expect(pad3(1)).toBe('001');
    expect(pad3(42)).toBe('042');
    expect(pad3(123)).toBe('123');
  });
  it('leaves a 4-digit overflow as-is (so it fails validation, not silently truncates)', () => {
    expect(pad3(1000)).toBe('1000');
  });
});

describe('nextJobNumber', () => {
  const jobs = [
    { job_id: '26_011_Kuhn' },
    { job_id: '26_042_Gonzalez' },
    { job_id: '25_054_Malanga_Subdivide' }, // different year — ignored
    { job_id: '26_007_FF_Williams' },       // FF_ prefix — still counts its number
  ];
  it('returns max existing NNN + 1 for the given year', () => {
    expect(nextJobNumber(jobs, '26')).toBe(43);
  });
  it('starts at 1 when the year has no jobs', () => {
    expect(nextJobNumber(jobs, '27')).toBe(1);
    expect(nextJobNumber([], '26')).toBe(1);
  });
  it('accepts plain id strings too', () => {
    expect(nextJobNumber(['26_005_A', '26_009_B'], '26')).toBe(10);
  });
});

describe('nextJobNumberAcross (app DB + Drive)', () => {
  const jobs = [{ job_id: '26_011_Kuhn' }, { job_id: '26_042_Gonzalez' }];
  it('uses Drive when it is ahead of the app DB', () => {
    // A job filed in Drive (045) but not yet added to the app → recommend 046, not 043.
    expect(nextJobNumberAcross(jobs, '26', [11, 42, 45])).toBe(46);
  });
  it('uses the app DB when it is ahead of Drive', () => {
    expect(nextJobNumberAcross(jobs, '26', [11, 40])).toBe(43);
  });
  it('falls back to the DB-only suggestion when Drive is empty/unavailable', () => {
    expect(nextJobNumberAcross(jobs, '26', [])).toBe(43);
    expect(nextJobNumberAcross(jobs, '26')).toBe(43);
  });
  it('ignores Drive numbers from other years (caller passes only this year)', () => {
    expect(nextJobNumberAcross([], '27', [])).toBe(1);
  });
});

describe('buildJobId', () => {
  it('assembles a standard id', () => {
    expect(buildJobId({ yy: '26', nnn: '012', name: 'Smith' })).toBe('26_012_Smith');
  });
  it('inserts FF_ when forefront', () => {
    expect(buildJobId({ yy: '26', nnn: '012', forefront: true, name: 'Smith' })).toBe('26_012_FF_Smith');
  });
  it('turns spaces in the name into underscores', () => {
    expect(buildJobId({ yy: '25', nnn: '054', name: 'Malanga Subdivide' })).toBe('25_054_Malanga_Subdivide');
  });
  it('returns empty string when a part is missing', () => {
    expect(buildJobId({ yy: '26', nnn: '012', name: '' })).toBe('');
    expect(buildJobId({ yy: '', nnn: '012', name: 'Smith' })).toBe('');
  });
});

describe('validateJobId', () => {
  it('accepts a valid, unused id', () => {
    expect(validateJobId('26_012_Smith', ['26_011_Kuhn'])).toEqual({ valid: true, reason: null });
  });
  it('flags an empty id', () => {
    expect(validateJobId('', []).reason).toBe('empty');
  });
  it('flags a bad format', () => {
    expect(validateJobId('26-012-Smith', []).reason).toBe('format');
    expect(validateJobId('2_12_Smith', []).reason).toBe('format');
  });
  it('flags a duplicate (accepts a Set or an array)', () => {
    expect(validateJobId('26_011_Kuhn', ['26_011_Kuhn']).reason).toBe('duplicate');
    expect(validateJobId('26_011_Kuhn', new Set(['26_011_Kuhn'])).reason).toBe('duplicate');
  });
  it('built FF ids pass validation', () => {
    const id = buildJobId({ yy: '26', nnn: '007', forefront: true, name: 'Williams' });
    expect(JOB_ID_RE.test(id)).toBe(true);
    expect(validateJobId(id, []).valid).toBe(true);
  });
});
