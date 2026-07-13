import { describe, it, expect } from 'vitest';
import { buildUpdateEmail, phaseSentence, projectLabel } from '../api/_lib/portal-notify.js';
import { buildMimeMessage, encodeHeader, toBase64Url } from '../api/_lib/gmail-send.js';
import { PHASES } from '../api/_lib/db.js';

const job = {
  job_id: '26_028_FF_Tysk',
  client_name: 'Nick Tysk',
  address: '705 First Street\nWestfield, NJ 07090',
  phase: 'design_phase',
  next_milestone_label: 'Design Meeting 2',
  next_milestone_date: '2026-08-04',
};
const client = { name: 'Nick Tysk', email: 'nicktysk@gmail.com' };
const LINK = 'https://rm117-bms.vercel.app/enter?t=abc123';

const compose = (over = {}) =>
  buildUpdateEmail({ job, client, link: LINK, senderName: 'Raymond', ...over });

describe('the client update email', () => {
  it('goes to the client and names their project by ADDRESS, not Job ID', () => {
    const e = compose();
    expect(e.to).toBe('nicktysk@gmail.com');
    // A homeowner does not know what "26_028_FF_Tysk" is.
    expect(e.subject).toBe('Update on 705 First Street');
    expect(e.subject).not.toContain('26_028');
    expect(e.text).not.toContain('26_028');
  });

  it('opens by name and reads like a person wrote it', () => {
    const e = compose();
    expect(e.text.startsWith('Hi Nick,')).toBe(true);
    expect(e.text).toContain('We’re in the design phase.');
    expect(e.text).toContain('Raymond'); // signed by a human, not "noreply"
  });

  it('carries the magic link and says no password is needed', () => {
    const e = compose();
    expect(e.text).toContain(LINK);
    expect(e.text.toLowerCase()).toContain('no password');
  });

  it('includes the next milestone when there is one', () => {
    expect(compose().text).toContain('Next up: Design Meeting 2 — August 4.');
  });

  it('says nothing about a milestone when none is set', () => {
    const e = compose({ job: { ...job, next_milestone_label: null, next_milestone_date: null } });
    expect(e.text).not.toContain('Next up');
  });

  it('carries the staff member’s own note — the reason a HUMAN presses send', () => {
    const e = compose({ note: 'We heard back from the town — the survey is scheduled for Tuesday.' });
    expect(e.text).toContain('the survey is scheduled for Tuesday');
  });

  it('NEVER leaks money, sub-phases, or internal jargon to the client', () => {
    // These are the things the portal deliberately hides. An email that says the CDs are
    // "90% done" invites "so where's my set?" — which is the opposite of the goal.
    // Matched as WHOLE WORDS: "preparing your construction drawings" is good human English
    // and must not trip a check aimed at the sub-phase named "Prep".
    const banned = ['outstanding', 'invoice', 'prep', 'outgoing', 'dpi', 'dpii', 'forefront', 'cd', 'cds'];
    for (const p of ['cd_prep', 'cd_outgoing', 'design_phase', 'permitting', 'construction']) {
      const e = compose({ job: { ...job, phase: p } });
      const body = `${e.subject}\n${e.text}`.toLowerCase();
      expect(body, `money leaked on phase ${p}`).not.toContain('$');
      for (const leak of banned) {
        expect(new RegExp(`\\b${leak}\\b`).test(body), `"${leak}" leaked on phase ${p}`).toBe(false);
      }
    }
  });

  it('speaks plain English for every phase a client can be in — no raw keys', () => {
    for (const p of PHASES) {
      const s = phaseSentence(p);
      expect(s).toBeTruthy();
      expect(s).not.toContain('_'); // never "cd_prep" / "survey_zoning"
    }
  });

  it('both CD phases read identically to a client (the split is internal)', () => {
    expect(phaseSentence('cd_prep')).toBe(phaseSentence('cd_outgoing'));
  });

  it('falls back gracefully when there is no address or no name', () => {
    expect(projectLabel({ address: '', client_name: 'Jane Doe' })).toBe('Jane Doe');
    expect(projectLabel({})).toBe('your project');
    expect(compose({ client: { name: '', email: 'x@y.com' } }).text.startsWith('Hi,')).toBe(true);
  });
});

describe('the Gmail message envelope', () => {
  it('addresses the message and keeps the subject', () => {
    const raw = buildMimeMessage({ to: 'a@b.com', subject: 'Update on 705 First Street', text: 'Hi' });
    expect(raw).toContain('To: a@b.com');
    expect(raw).toContain('Subject: Update on 705 First Street');
    expect(raw).toContain('charset="UTF-8"');
    expect(raw.split('\r\n\r\n')[1]).toBe('Hi'); // headers, blank line, then the body
  });

  it('encodes a non-ASCII subject rather than sending mojibake', () => {
    // Real client names have accents; the em-dash in our own copy is non-ASCII too.
    expect(encodeHeader('Update — Renée')).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeader('Plain ASCII')).toBe('Plain ASCII');
  });

  it('base64url-encodes for Gmail (no +, /, or padding)', () => {
    const enc = toBase64Url('subjects??>>~~ with + and / bytes');
    expect(enc).not.toMatch(/[+/=]/);
    expect(Buffer.from(enc.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
      .toBe('subjects??>>~~ with + and / bytes');
  });
});
