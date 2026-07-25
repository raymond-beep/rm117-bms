import { describe, it, expect } from 'vitest';
import { CLIENT_LADDER, nextLadderStep, deriveNextUp } from '../api/_lib/portal-ladder.js';
import { CLIENT_LADDER as FRONTEND_LADDER } from '../src/lib/portal-ladder.js';
import { PHASES } from '../api/_lib/db.js';

describe('the client ladder stays in sync', () => {
  // The server derives "Next up" from its copy; the portal draws the stepper from the
  // frontend copy. If they drift, a client is told the next step is one thing and shown
  // a stepper that says another.
  it('server and frontend ladders are identical', () => {
    expect(CLIENT_LADDER).toEqual(FRONTEND_LADDER);
  });

  it('every phase named on the ladder is a real stored phase', () => {
    for (const step of CLIENT_LADDER) {
      for (const p of step.phases) {
        expect(PHASES, `${p} is not a stored phase`).toContain(p);
      }
    }
  });

  it('no stored phase appears on two rungs', () => {
    const all = CLIENT_LADDER.flatMap((s) => s.phases);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('nextLadderStep', () => {
  it('names the following rung', () => {
    expect(nextLadderStep('potential').label).toBe('Survey / Zoning');
    expect(nextLadderStep('survey_zoning').label).toBe('Design');
    expect(nextLadderStep('design_phase').label).toBe('Construction Drawings');
    expect(nextLadderStep('permitting').label).toBe('Construction');
    expect(nextLadderStep('construction').label).toBe('Complete');
  });

  // The CD split is a staff workload tool. Both halves must look the same from outside,
  // or "Next up: CD — Outgoing" leaks it through the back door.
  it('never leaks the internal CD split', () => {
    expect(nextLadderStep('cd_prep').label).toBe('Permitting');
    expect(nextLadderStep('cd_outgoing').label).toBe('Permitting');
  });

  it('has no next for the last rung or the off-ladder states', () => {
    expect(nextLadderStep('completed')).toBeNull();
    expect(nextLadderStep('on_hold')).toBeNull(); // paused work must not advertise a next step
    expect(nextLadderStep('canceled')).toBeNull();
    expect(nextLadderStep('job_dropped')).toBeNull();
    expect(nextLadderStep('lead')).toBeNull();
    expect(nextLadderStep(null)).toBeNull();
    expect(nextLadderStep('not_a_phase')).toBeNull();
  });
});

describe('deriveNextUp', () => {
  it('a staff-typed milestone wins, and keeps its date', () => {
    const out = deriveNextUp({
      phase: 'design_phase',
      next_milestone_label: 'Township review meeting',
      next_milestone_date: '2026-08-14',
    });
    expect(out).toEqual({ label: 'Township review meeting', date: '2026-08-14', derived: false });
  });

  it('falls back to the next rung when nothing is typed', () => {
    const out = deriveNextUp({ phase: 'design_phase', next_milestone_label: null });
    expect(out).toEqual({ label: 'Construction Drawings', date: null, derived: true });
  });

  it('treats a blank/whitespace label as unset', () => {
    expect(deriveNextUp({ phase: 'survey_zoning', next_milestone_label: '   ' }).label).toBe('Design');
  });

  // The date the firm assigns a phase is an internal planning figure. Publishing it turns
  // an estimate into a commitment the client will hold the firm to.
  it('never attaches a date to a derived label', () => {
    const out = deriveNextUp({
      phase: 'permitting',
      next_milestone_label: '',
      next_milestone_date: '2026-09-01',
    });
    expect(out.derived).toBe(true);
    expect(out.date).toBeNull();
  });

  it('shows nothing rather than guessing for off-ladder jobs', () => {
    for (const phase of ['on_hold', 'completed', 'canceled', 'job_dropped']) {
      expect(deriveNextUp({ phase }).label, phase).toBeNull();
    }
  });

  it('survives a missing job', () => {
    expect(deriveNextUp(null).label).toBeNull();
    expect(deriveNextUp({}).label).toBeNull();
  });
});
