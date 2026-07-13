import { describe, it, expect } from 'vitest';
import { PHASES, SUB_PHASES, isValidSubPhase } from '../api/_lib/db.js';
import {
  PHASE_LABELS, PHASE_ORDER, PHASE_LADDER, PIPELINE_PHASES, BOARD_TABS,
  SUB_PHASE_LABELS, subPhasesFor, subPhaseLabel,
  PHASE_AGE_LIMITS, daysInPhase, isStalled,
} from '../src/lib/format.js';

const DAY = 86_400_000;

describe('phase set stays in sync across the app', () => {
  it('every stored phase has a BMS label', () => {
    for (const p of PHASES) expect(PHASE_LABELS[p], `no label for ${p}`).toBeTruthy();
  });

  it('every stored phase appears exactly once in the board order', () => {
    expect([...PHASE_ORDER].sort()).toEqual([...PHASES].sort());
  });

  it('every phase belongs to exactly one board tab', () => {
    const tabbed = BOARD_TABS.flatMap((t) => t.phases);
    expect([...tabbed].sort()).toEqual([...PHASES].sort());
    expect(new Set(tabbed).size).toBe(tabbed.length); // no phase in two tabs
  });

  it("'active' and 'cd_phase' are both gone — CD is two real phases now", () => {
    expect(PHASES).not.toContain('active');   // was really CD's wrap-up stage
    expect(PHASES).not.toContain('cd_phase'); // split into cd_prep + cd_outgoing (Ang)
    expect(PHASES).toContain('cd_prep');
    expect(PHASES).toContain('cd_outgoing');
  });

  it('keeps job_dropped and canceled as DIFFERENT terminal states', () => {
    // dropped = proposal rejected, never started. canceled = signed, then terminated.
    expect(PHASES).toContain('job_dropped');
    expect(PHASES).toContain('canceled');
  });

  it('the ladder runs lead → … → completed and excludes the off-ladder states', () => {
    expect(PHASE_LADDER[0]).toBe('lead');
    expect(PHASE_LADDER.at(-1)).toBe('completed');
    for (const off of ['on_hold', 'job_dropped', 'canceled']) {
      expect(PHASE_LADDER).not.toContain(off);
    }
    // CD runs Prep → Outgoing, then Permitting, then Construction.
    const at = (p) => PHASE_LADDER.indexOf(p);
    expect(at('design_phase')).toBeLessThan(at('cd_prep'));
    expect(at('cd_prep')).toBeLessThan(at('cd_outgoing'));
    expect(at('cd_outgoing')).toBeLessThan(at('permitting'));
    expect(at('permitting')).toBeLessThan(at('construction'));
  });

  it('the working pipeline excludes leads, post-CD work and the terminal states', () => {
    for (const p of ['lead', 'potential', 'permitting', 'construction', 'completed', 'on_hold', 'job_dropped', 'canceled']) {
      expect(PIPELINE_PHASES).not.toContain(p);
    }
  });

  it('the Pipeline tab ENDS with the CD stage (Ang: permitting is not pipeline work)', () => {
    const pipeline = BOARD_TABS.find((t) => t.key === 'pipeline').phases;
    expect(pipeline).toContain('cd_prep');
    expect(pipeline).toContain('cd_outgoing');
    expect(pipeline).not.toContain('permitting');   // moved to In-Construction
    expect(pipeline).not.toContain('construction');
    expect(pipeline).not.toContain('lead');
  });

  it('In-Construction holds permitting, construction and the finished jobs', () => {
    const c = BOARD_TABS.find((t) => t.key === 'construction').phases;
    expect(c).toEqual(expect.arrayContaining(['permitting', 'construction', 'completed', 'canceled']));
  });
});

describe('sub-phases', () => {
  it('ONLY Design has them — CD is two real phases, not sub-phases', () => {
    expect(Object.keys(SUB_PHASES)).toEqual(['design_phase']);
    expect(SUB_PHASES.cd_phase).toBeUndefined();
  });

  it('every sub-phase has a label', () => {
    for (const s of Object.values(SUB_PHASES).flat()) expect(SUB_PHASE_LABELS[s]).toBeTruthy();
  });

  it('no phase accepts the retired CD sub-phases', () => {
    for (const p of PHASES) {
      expect(isValidSubPhase(p, 'prep')).toBe(false);
      expect(isValidSubPhase(p, 'outgoing')).toBe(false);
    }
  });

  it('design sub-phases are capped by what the proposal bought', () => {
    expect(subPhasesFor({ phase: 'design_phase', design_phase_count: 2 })).toEqual(['dp1', 'dp2']);
    expect(subPhasesFor({ phase: 'design_phase', design_phase_count: 1 })).toEqual(['dp1']);
    // Unset count → offer all three rather than none.
    expect(subPhasesFor({ phase: 'design_phase' })).toEqual(['dp1', 'dp2', 'dp3']);
    // A count beyond the ladder can't invent a DPIV.
    expect(subPhasesFor({ phase: 'design_phase', design_phase_count: 9 })).toEqual(['dp1', 'dp2', 'dp3']);
  });

  it('a phase with no sub-phases offers none', () => {
    expect(subPhasesFor({ phase: 'permitting' })).toEqual([]);
    expect(subPhaseLabel({ sub_phase: null })).toBeNull();
  });

  it('rejects a sub-phase on a phase that has none', () => {
    expect(isValidSubPhase('design_phase', 'dp2')).toBe(true);
    expect(isValidSubPhase('cd_prep', 'dp2')).toBe(false);
    expect(isValidSubPhase('cd_outgoing', 'dp2')).toBe(false);
    expect(isValidSubPhase('permitting', 'dp1')).toBe(false);
  });

  it('a null sub-phase is always allowed', () => {
    expect(isValidSubPhase('cd_outgoing', null)).toBe(true);
    expect(isValidSubPhase('permitting', '')).toBe(true);
  });
});

describe('aging flags (Ang: 2 weeks on a proposal, 3 on CDs)', () => {
  const now = Date.now();
  const ago = (d) => new Date(now - d * DAY).toISOString();

  it('uses the limits Ray specified — and the 3-week CD rule covers BOTH halves', () => {
    expect(PHASE_AGE_LIMITS.potential).toBe(14);
    expect(PHASE_AGE_LIMITS.cd_prep).toBe(21);
    expect(PHASE_AGE_LIMITS.cd_outgoing).toBe(21);
  });

  it('counts days from when the job entered the phase', () => {
    expect(daysInPhase({ phase_since: ago(10) }, now)).toBe(10);
  });

  it('flags a proposal a client has sat on too long', () => {
    expect(isStalled({ phase: 'potential', phase_since: ago(15) }, now)).toBe(true);
    expect(isStalled({ phase: 'potential', phase_since: ago(13) }, now)).toBe(false);
  });

  it('flags CDs over three weeks', () => {
    expect(isStalled({ phase: 'cd_prep', phase_since: ago(22) }, now)).toBe(true);
    expect(isStalled({ phase: 'cd_outgoing', phase_since: ago(20) }, now)).toBe(false);
  });

  it('never flags a phase with no limit — a long design phase is not a problem', () => {
    expect(isStalled({ phase: 'design_phase', phase_since: ago(400) }, now)).toBe(false);
    expect(isStalled({ phase: 'completed', phase_since: ago(999) }, now)).toBe(false);
  });

  it('falls back to updated_at, and stays quiet when there is no date at all', () => {
    expect(isStalled({ phase: 'potential', updated_at: ago(30) }, now)).toBe(true);
    expect(daysInPhase({ phase: 'potential' }, now)).toBeNull();
    expect(isStalled({ phase: 'potential' }, now)).toBe(false);
  });
});
