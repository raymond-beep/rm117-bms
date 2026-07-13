import { describe, it, expect } from 'vitest';
import { isPdf, pdfsOnly, rankProposals } from '../api/_lib/drive-docs.js';

const pdf = (name) => ({ id: name, name, mimeType: 'application/pdf' });
const other = (name, mimeType) => ({ id: name, name, mimeType });

describe('pdfsOnly', () => {
  it('drops the working-file noise a job folder accumulates', () => {
    const files = [
      pdf('Proposal 06.28.26.pdf'),
      other('plot.log', 'text/plain'),
      other('CONSTRUCTION ESTIMATE.xlsx', 'application/vnd.ms-excel'),
      other('notes.docx', 'application/msword'),
    ];
    expect(pdfsOnly(files).map((f) => f.name)).toEqual(['Proposal 06.28.26.pdf']);
  });

  it('handles an empty / missing listing', () => {
    expect(pdfsOnly([])).toEqual([]);
    expect(pdfsOnly()).toEqual([]);
  });

  it('isPdf is defensive about junk input', () => {
    expect(isPdf(null)).toBe(false);
    expect(isPdf({})).toBe(false);
    expect(isPdf(pdf('a.pdf'))).toBe(true);
  });
});

describe('rankProposals', () => {
  it('floats the signed contract to the top', () => {
    const files = [pdf('Proposal 06.28.26.pdf'), pdf('Knapp - SIGNED proposal.pdf')];
    expect(rankProposals(files).map((f) => f.name)).toEqual([
      'Knapp - SIGNED proposal.pdf',
      'Proposal 06.28.26.pdf',
    ]);
  });

  it('recognises executed / countersigned as signed too', () => {
    const files = [pdf('Proposal.pdf'), pdf('Executed Agreement.pdf')];
    expect(rankProposals(files)[0].name).toBe('Executed Agreement.pdf');
  });

  it('preserves the incoming newest-first order among equals (stable sort)', () => {
    const files = [pdf('Proposal Rev B.pdf'), pdf('Proposal Rev A.pdf')];
    expect(rankProposals(files).map((f) => f.name)).toEqual([
      'Proposal Rev B.pdf',
      'Proposal Rev A.pdf',
    ]);
  });

  it('filters non-PDFs before ranking', () => {
    const files = [other('signed.txt', 'text/plain'), pdf('Proposal.pdf')];
    expect(rankProposals(files).map((f) => f.name)).toEqual(['Proposal.pdf']);
  });

  it('does not match "signed" inside another word', () => {
    const files = [pdf('Proposal.pdf'), pdf('Unassigned scope.pdf')];
    expect(rankProposals(files)[0].name).toBe('Proposal.pdf');
  });
});
