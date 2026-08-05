// Global search ranking (src/lib/search.js) — the rules that decide which of 134
// jobs a staffer actually meant.
import { describe, it, expect } from 'vitest';
import { searchRecords, searchPortalClients, filterClientDirectory } from '../src/lib/search.js';

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

// ---------------------------------------------------------------------------
// The portal-preview picker resolves everything down to "whose portal do I open?"
const PJOBS = [
  { job_id: '26_001_Deuel', client_id: 'c1', client_name: 'Tyler Deuel', phase: 'design_phase' },
  { job_id: '26_003_Deuel', client_id: 'c1', client_name: 'Tyler Deuel', phase: 'cd_prep' },
  { job_id: '22_010_Malanga', client_id: 'c2', client_name: 'Joe Malanga', phase: 'completed' },
  // A Drive import: real Job ID, no client linked yet (28 of these exist in prod).
  { job_id: '26_044_Seesman', client_id: null, client_name: 'Seesman', phase: 'survey_zoning' },
];

describe('searchPortalClients', () => {
  it('browses every client alphabetically when nothing is typed', () => {
    const all = searchPortalClients('', PJOBS, CLIENTS);
    expect(all.map((m) => m.title)).toEqual(['Joe Malanga', 'Tyler Deuel']);
  });

  it('finds a client by Job ID — staff think in Job IDs', () => {
    const [top] = searchPortalClients('26_003_Deuel', PJOBS, CLIENTS);
    expect(top).toMatchObject({ clientId: 'c1', title: 'Tyler Deuel', meta: '26_003_Deuel' });
  });

  it('finds a client by name', () => {
    const [top] = searchPortalClients('malanga', PJOBS, CLIENTS);
    expect(top.clientId).toBe('c2');
  });

  // The whole point of the dedupe: Tyler matches by name AND on two jobs.
  it('offers a client ONCE even when several of their jobs match', () => {
    const hits = searchPortalClients('deuel', PJOBS, CLIENTS);
    expect(hits.filter((m) => m.clientId === 'c1')).toHaveLength(1);
  });

  it('surfaces a job with no client linked, and marks it unselectable', () => {
    const [top] = searchPortalClients('26_044', PJOBS, CLIENTS);
    expect(top.unlinked).toBe(true);
    expect(top.clientId).toBeNull();
    expect(top.meta).toContain('no client linked');
  });

  it('returns nothing when neither a name nor a Job ID matches', () => {
    expect(searchPortalClients('zzzz', PJOBS, CLIENTS)).toEqual([]);
  });

  it('is case-insensitive on Job IDs', () => {
    expect(searchPortalClients('26_001_deuel', PJOBS, CLIENTS)[0].clientId).toBe('c1');
  });
});

// ── Clients directory filter ───────────────────────────────────────────────
// Unlike the two rankers above, this one must return EVERY match — it backs a directory,
// and quietly truncating it would hide clients from the screen that exists to show them all.
describe('filterClientDirectory', () => {
  const clients = [
    {
      id: 'a', name: 'Tyler Deuel', company: 'Deuel Development', email: 'tyler@deuel.com', phone: '(908) 451-4633',
      contacts: [{ name: 'Maria Sanchez', email: 'maria@deuel.com' }],
      jobs: [{ job_id: '26_001_Deuel', address: '12 Oak Ave, Westfield NJ' }],
    },
    {
      id: 'b', name: 'Mike Costello', company: null, email: null, phone: null,
      contacts: [], jobs: [{ job_id: '25_085_OBagel', address: '1 Knapp Ave' }],
    },
    { id: 'c', name: 'Frank Chou', company: null, email: 'frank@example.com', phone: null, contacts: [], jobs: [] },
  ];

  it('returns everything when the query is empty', () => {
    expect(filterClientDirectory('', clients)).toHaveLength(3);
    expect(filterClientDirectory('   ', clients)).toHaveLength(3);
  });

  it('finds a client by name', () => {
    expect(filterClientDirectory('costello', clients).map((c) => c.id)).toEqual(['b']);
  });

  it('finds a client by company', () => {
    expect(filterClientDirectory('deuel development', clients).map((c) => c.id)).toEqual(['a']);
  });

  it('finds a client by their Job ID', () => {
    // The office speaks Job ID; the client's own name is often not what someone remembers.
    expect(filterClientDirectory('25_085', clients).map((c) => c.id)).toEqual(['b']);
  });

  it('finds a client by job address', () => {
    expect(filterClientDirectory('knapp', clients).map((c) => c.id)).toEqual(['b']);
  });

  it("finds a client by a CONTACT's name", () => {
    // A developer's PM is often the only person you've actually emailed.
    expect(filterClientDirectory('maria', clients).map((c) => c.id)).toEqual(['a']);
  });

  it('matches a phone number regardless of formatting', () => {
    expect(filterClientDirectory('9084514633', clients).map((c) => c.id)).toEqual(['a']);
    expect(filterClientDirectory('451-4633', clients).map((c) => c.id)).toEqual(['a']);
  });

  it('returns every match, not a ranked top-N', () => {
    // "e" appears in all three names — a directory shows all of them.
    expect(filterClientDirectory('e', clients).length).toBe(3);
  });

  it('returns nothing on a genuine miss', () => {
    expect(filterClientDirectory('zzzznotaclient', clients)).toEqual([]);
  });

  it('survives clients with no jobs or contacts', () => {
    expect(() => filterClientDirectory('x', [{ id: 'd', name: 'Bare' }])).not.toThrow();
  });
});
