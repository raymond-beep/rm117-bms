// Global search ranking (src/lib/search.js) — the rules that decide which of 134
// jobs a staffer actually meant.
import { describe, it, expect } from 'vitest';
import { searchRecords } from '../src/lib/search.js';

const JOBS = [
  { job_id: '26_001_Deuel', client_name: 'Tyler Deuel', phase: 'design_phase', address: '12 Oak St\nMadison NJ' },
  { job_id: '26_003_Deuel', client_name: 'Tyler Deuel', phase: 'cd_prep', address: '4 Elm Ave' },
  { job_id: '24_005_Dunn_Nosker', client_name: 'Dan Nosker', phase: 'construction', address: '9 Deuel Road' },
  { job_id: '22_010_Malanga', client_name: 'Joe Malanga', phase: 'completed', address: '1 Main St' },
  { job_id: '26_040_Smith', client_name: 'Ann Smith', phase: 'lead', address: null, notes: 'referred by Deuel' },
];

const CLIENTS = [
  { id: 'c1', name: 'Tyler Deuel', company: 'Deuel Development', email: 'tyler@deuel.com', is_active: true },
  { id: 'c2', name: 'Joe Malanga', company: null, email: 'joe@example.com', is_active: true },
];

describe('searchRecords', () => {
  it('returns nothing for an empty query', () => {
    expect(searchRecords('', JOBS, CLIENTS)).toEqual([]);
    expect(searchRecords('   ', JOBS, CLIENTS)).toEqual([]);
  });

  it('puts an exact Job ID first — typing the key means you want that job', () => {
    const [top] = searchRecords('26_003_Deuel', JOBS, CLIENTS);
    expect(top).toMatchObject({ kind: 'job', id: '26_003_Deuel' });
  });

  it('ranks a name match above an address or notes match', () => {
    // "Deuel" is a client name, a street name on the Nosker job, and a word in
    // Smith's notes. The Deuel jobs/client must come first.
    const hits = searchRecords('deuel', JOBS, CLIENTS);
    const ids = hits.map((h) => h.id);
    expect(ids.indexOf('9 Deuel Road')).toBe(-1); // address isn't its own hit
    const noskerAt = ids.indexOf('24_005_Dunn_Nosker');
    const smithAt = ids.indexOf('26_040_Smith');
    for (const wanted of ['26_001_Deuel', '26_003_Deuel']) {
      expect(ids.indexOf(wanted)).toBeLessThan(noskerAt);
      expect(ids.indexOf(wanted)).toBeLessThan(smithAt);
    }
  });

  it('finds a job by the second word of a compound ID', () => {
    const ids = searchRecords('nosker', JOBS, CLIENTS).map((h) => h.id);
    expect(ids).toContain('24_005_Dunn_Nosker');
  });

  it('ranks live work above completed work', () => {
    const jobs = [
      { job_id: '22_010_Ross', client_name: 'Ross Family', phase: 'completed' },
      { job_id: '26_050_Ross', client_name: 'Ross Family', phase: 'design_phase' },
    ];
    const [top] = searchRecords('ross', jobs, []);
    expect(top.id).toBe('26_050_Ross');
  });

  it('matches clients by company and email, not just name', () => {
    const byCompany = searchRecords('development', [], CLIENTS);
    expect(byCompany[0]).toMatchObject({ kind: 'client', id: 'c1' });

    const byEmail = searchRecords('joe@example', [], CLIENTS);
    expect(byEmail[0]).toMatchObject({ kind: 'client', id: 'c2' });
  });

  it('carries the phase as a job hit’s meta line', () => {
    const [top] = searchRecords('26_001_Deuel', JOBS, []);
    expect(top.meta).toBe('Design Phase');
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      job_id: `26_${i}_Test`, client_name: 'Test Client', phase: 'design_phase',
    }));
    expect(searchRecords('test', many, []).length).toBe(8);
  });

  it('is case-insensitive', () => {
    expect(searchRecords('DEUEL', JOBS, []).length).toBeGreaterThan(0);
  });
});
