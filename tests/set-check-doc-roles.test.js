// Which Drive PDF is the schedule / REScheck / submittal. The filenames here are
// REAL ones from the firm's Drive (probed 2026-07-21) — the spelling of "REScheck"
// is inconsistent in practice, which is the whole reason this logic exists.
import { describe, it, expect } from 'vitest';
import { scoreForRole, suggestRoles } from '../api/_lib/set-check/doc-roles.js';

const file = (name, folderName = 'Files Sent', id = name) => ({ id, name, folderName });

describe('scoreForRole — rescheck', () => {
  it('matches every spelling the firm actually uses', () => {
    for (const name of [
      '260617_ResCheck.pdf',
      'ResCheck - 09.15.25.pdf',
      '260309_Rescheck_508 Dorian.pdf',
      'REScheck.pdf',
      'res check report.pdf',
    ]) {
      expect(scoreForRole(file(name), 'rescheck'), name).toBeGreaterThan(0);
    }
  });

  it('does not match an unrelated document', () => {
    expect(scoreForRole(file('Permit Application.pdf'), 'rescheck')).toBe(0);
  });

  it('prefers a REScheck in Files Sent over a stray copy elsewhere', () => {
    const sent = scoreForRole(file('ResCheck.pdf', 'Files Sent'), 'rescheck');
    const loose = scoreForRole(file('ResCheck.pdf', 'Archive'), 'rescheck');
    expect(sent).toBeGreaterThan(loose);
  });
});

describe('scoreForRole — submittal', () => {
  it('recognises a brochure named after the product, not "submittal"', () => {
    // The normal case: the contractor sends the vendor's own literature.
    expect(scoreForRole(file('Andersen 400 Series.pdf', 'Files Received'), 'submittal')).toBeGreaterThan(0);
    expect(scoreForRole(file('Pella Reserve cut sheet.pdf', 'Files Received'), 'submittal')).toBeGreaterThan(0);
  });

  it('does NOT qualify a file on its folder alone', () => {
    // Files Received is a general inbound pile, not a submittals folder. These are
    // real files from three jobs, each of which an earlier rule offered as the
    // window brochure purely because of where it sat.
    for (const name of ['survey.pdf', 'Client Comments_06_20_25.pdf', '422579-Zoning_Denial.pdf', 'scan001.pdf']) {
      expect(scoreForRole(file(name, 'Files Received'), 'submittal'), name).toBe(0);
    }
  });

  it('ranks a brochure that arrived from the contractor above one filed elsewhere', () => {
    const received = scoreForRole(file('Andersen 400 Series.pdf', 'Files Received'), 'submittal');
    const loose = scoreForRole(file('Andersen 400 Series.pdf', 'Reference'), 'submittal');
    expect(received).toBeGreaterThan(loose);
  });

  it('ignores a document we sent, even one named like a brochure', () => {
    expect(scoreForRole(file('Window Schedule.pdf', 'Files Sent'), 'submittal')).toBe(0);
  });

  it('rejects a manufacturer name on the wrong KIND of document', () => {
    expect(scoreForRole(file('Pella invoice.pdf', 'Files Received'), 'submittal')).toBe(0);
    for (const name of ['Plot Plan.pdf', 'Final Invoice.pdf', 'Deed.pdf', 'Permit Application.pdf']) {
      expect(scoreForRole(file(name, 'Files Received'), 'submittal'), name).toBe(0);
    }
  });
});

describe('scoreForRole — schedule', () => {
  it('scores a named window schedule highest', () => {
    const named = scoreForRole(file('Window Schedule.pdf', 'Files Sent'), 'schedule');
    const drawing = scoreForRole(file('260101_Permit Set.pdf', 'Checksets'), 'schedule');
    expect(named).toBeGreaterThan(drawing);
    // A drawing set is still a candidate — the schedule is a table inside it.
    expect(drawing).toBeGreaterThan(0);
  });

  it('ignores a contractor document', () => {
    expect(scoreForRole(file('Andersen 400 Series.pdf', 'Files Received'), 'schedule')).toBe(0);
  });

  it('prefers the issued set over a markup or prelim copy of it', () => {
    // Real filenames from 24_073_Dasilva. Checking windows against a superseded
    // set is the failure mode: the sizes on a markup copy may never have shipped.
    const conformed = scoreForRole(file('260303_Conformed Permit Set_Updtd Design.pdf', 'Files Sent'), 'schedule');
    const markup = scoreForRole(file('24_073_Dasilva_101Maple_251212_TD MARKUPS.pdf', 'Checksets'), 'schedule');
    const prelim = scoreForRole(file('241111_Prelim Permit Set.pdf', 'Checksets'), 'schedule');
    expect(conformed).toBeGreaterThan(prelim);
    expect(prelim).toBeGreaterThan(markup);
    expect(markup).toBe(0);
  });
});

describe('suggestRoles', () => {
  const files = [
    file('Andersen 400 Series brochure.pdf', 'Files Received', 'brochure'),
    file('260617_ResCheck.pdf', 'Files Sent', 'rescheck'),
    file('260101_Window Schedule.pdf', 'Files Sent', 'schedule'),
    file('Permit Application.pdf', 'Files Sent', 'permit'),
  ];

  it('picks one document per role', () => {
    expect(suggestRoles(files)).toEqual({
      schedule: 'schedule',
      rescheck: 'rescheck',
      submittal: 'brochure',
    });
  });

  it('returns null for a role with no candidate rather than guessing', () => {
    // A wrong guess must cost a click, never a wrong answer — an empty slot is
    // honest, a confidently-wrong pre-pick is what gets confirmed by accident.
    const out = suggestRoles([file('Permit Application.pdf', 'Files Sent', 'permit')]);
    expect(out.rescheck).toBeNull();
    expect(out.submittal).toBeNull();
  });

  it('survives an empty listing', () => {
    expect(suggestRoles([])).toEqual({ schedule: null, rescheck: null, submittal: null });
  });
});
