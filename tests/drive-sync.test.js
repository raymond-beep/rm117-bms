// Drive → app sync rules (api/_lib/drive-sync.js).
// The folder names here are REAL ones from the RM117 Shared Drive (scanned 2026-07-14) —
// including the messy ones, because those are what actually break a naive parser.
import { describe, it, expect } from 'vitest';
import { parseFolderName, clientNameFrom, jobNumberOf, buildQueue } from '../api/_lib/drive-sync.js';

const WATERMARK = '2026-07-01T00:00:00Z';
const after = (name, id = name) => ({ id, name, createdTime: '2026-07-10T12:00:00Z' });
const before = (name, id = name) => ({ id, name, createdTime: '2024-03-01T12:00:00Z' });

describe('parseFolderName', () => {
  it('reads a plain numbered job', () => {
    expect(parseFolderName('26_044_Seesman')).toMatchObject({
      kind: 'job', jobId: '26_044_Seesman', clientName: 'Seesman',
      isForefront: false, suggestedPhase: 'survey_zoning',
    });
  });

  it('keeps a numbered job’s name VERBATIM — it is the QuickBooks key', () => {
    // Normalising this would break Job ID === QBO Customer Display Name === folder name.
    expect(parseFolderName('26_043_Goddard_104 Winslow Pl').jobId).toBe('26_043_Goddard_104 Winslow Pl');
  });

  it('treats FF_ as Forefront but leaves FE_ alone', () => {
    expect(parseFolderName('26_045_FF_Needham').isForefront).toBe(true);
    // FE_ is a real prefix in the Drive that the app has never modelled — guessing it
    // was Forefront would mis-file a commission.
    expect(parseFolderName('26_046_FE_Belleville').isForefront).toBe(false);
    expect(parseFolderName('26_046_FE_Belleville').jobId).toBe('26_046_FE_Belleville');
  });

  it('reads a lead folder and lowercases it to the app’s placeholder form', () => {
    // Drive types XXX; the app's JOB_ID_RE / isPlaceholderJobId only accept lowercase xxx.
    expect(parseFolderName('26_XXX_Onorato')).toMatchObject({
      kind: 'lead', jobId: '26_xxx_Onorato', clientName: 'Onorato', suggestedPhase: 'lead',
    });
    expect(parseFolderName('23_xxx_Rodriguez').jobId).toBe('23_xxx_Rodriguez');
  });

  it('carries Forefront through a lead', () => {
    expect(parseFolderName('26_XXX_FF_Corrigan')).toMatchObject({
      kind: 'lead', jobId: '26_xxx_FF_Corrigan', isForefront: true, clientName: 'Corrigan',
    });
  });

  it('ignores every folder that is not a job or a lead', () => {
    for (const name of ['2025 Jobs', 'Zoning', 'Window Specs', 'Untitled folder', 'Built Work', '171 Potomac', '']) {
      expect(parseFolderName(name)).toBeNull();
    }
  });

  it('ignores a year-and-number with nothing after it', () => {
    expect(parseFolderName('26_XXX_')).toBeNull();
  });
});

describe('clientNameFrom', () => {
  it('takes the surname and drops the FF_/FE_ marker', () => {
    expect(clientNameFrom('FF_Needham')).toBe('Needham');
    expect(clientNameFrom('FE_Belleville')).toBe('Belleville');
    expect(clientNameFrom('Goddard_104 Winslow Pl')).toBe('Goddard');
    expect(clientNameFrom('Deuel_Kayal')).toBe('Deuel');
  });
});

describe('jobNumberOf', () => {
  it('extracts the stable YY_NNN identity', () => {
    expect(jobNumberOf('26_002_Deuel_544_Valley')).toBe('26_002');
    expect(jobNumberOf('26_xxx_Onorato')).toBeNull(); // a lead has no number yet
  });
});

describe('buildQueue', () => {
  it('offers a job folder created after the watermark', () => {
    const q = buildQueue([after('26_044_Seesman')], [], { watermark: WATERMARK });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ jobId: '26_044_Seesman', kind: 'job', valid: true });
  });

  it('NEVER offers the historical backlog — the watermark is the whole design', () => {
    // 233 folders predate the sync. If these leaked through they would bury the board.
    const q = buildQueue(
      [before('24_005_Dunn_Nosker'), before('24_XXX_FF_Gallo')],
      [], { watermark: WATERMARK },
    );
    expect(q).toEqual([]);
  });

  it('skips a job the app already has, matching on the NUMBER not the name', () => {
    // Drive says 26_002 is "544 Valley"; the app says "542 Valley". The addresses are
    // genuinely swapped in the real data — it is still the same job, and re-importing it
    // would create a duplicate.
    const q = buildQueue(
      [after('26_002_Deuel_544_Valley')],
      [{ job_id: '26_002_Deuel_542 Valley' }],
      { watermark: WATERMARK },
    );
    expect(q).toEqual([]);
  });

  it('skips a lead the app already has, ignoring XXX/xxx case', () => {
    const q = buildQueue(
      [after('26_XXX_Onorato')],
      [{ job_id: '26_xxx_Onorato' }],
      { watermark: WATERMARK },
    );
    expect(q).toEqual([]);
  });

  it('skips a folder a staffer dismissed', () => {
    const q = buildQueue([after('26_044_Seesman', 'folder-1')], [], {
      watermark: WATERMARK, dismissedIds: ['folder-1'],
    });
    expect(q).toEqual([]);
  });

  it('tidies a sloppy LEAD name and lets it through', () => {
    // A real one: the stray space after XXX. A lead's id never reaches QuickBooks or
    // Drive-by-name, so cleaning it costs nothing.
    const q = buildQueue([after('24_XXX_ 120 Saint Paul')], [], { watermark: WATERMARK });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'lead', jobId: '24_xxx_120 Saint Paul', valid: true });
  });

  it('REFUSES to tidy a numbered job’s name — the app and the folder must agree', () => {
    // A numbered Job ID must equal the Drive folder name and the QBO Customer Display Name
    // character for character. Importing the tidied version would leave them disagreeing,
    // and QBO payments match on that name.
    const q = buildQueue([after('26_047_Smith  _Elm')], [], { watermark: WATERMARK });
    expect(q).toHaveLength(1);
    expect(q[0].valid).toBe(false);
    expect(q[0].problem).toMatch(/extra spaces/i);
    expect(q[0].problem).toContain('26_047_Smith _Elm'); // what to rename it to
  });

  it('puts the newest folder first', () => {
    const q = buildQueue([
      { id: 'a', name: '26_044_Seesman', createdTime: '2026-07-05T00:00:00Z' },
      { id: 'b', name: '26_046_FE_Belleville', createdTime: '2026-07-14T00:00:00Z' },
    ], [], { watermark: WATERMARK });
    expect(q.map((x) => x.folderId)).toEqual(['b', 'a']);
  });

  it('drops non-job folders even when they are brand new', () => {
    expect(buildQueue([after('Untitled folder'), after('Window Specs')], [], { watermark: WATERMARK })).toEqual([]);
  });
});
