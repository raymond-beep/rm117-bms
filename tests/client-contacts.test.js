import { describe, it, expect } from 'vitest';
import { buildUpdateEmail } from '../api/_lib/portal-notify.js';
import { mintToken, hashToken } from '../api/_lib/portal-session.js';

// Developers run projects with teams (Tyler Deuel, 5 jobs; Gabe DaSilva already cramming a
// shared team inbox into the single email field). Every one of them gets their own email and
// their own magic link.

const job = {
  job_id: '26_002_Deuel_542 Valley',
  client_name: 'Tyler Deuel',
  address: '542 Valley St\nCity of Orange, NJ 07050',
  phase: 'cd_prep',
};

const team = [
  { id: 'c1', name: 'Tyler Deuel', email: 'tyler@breatheeasyremodeling.com', is_primary: true },
  { id: 'c2', name: 'Sarah Chen', email: 'sarah@breatheeasyremodeling.com', role: 'Project manager' },
  { id: 'c3', name: null, email: 'office@breatheeasyremodeling.com' },
];

describe('one email per person on the team', () => {
  it('greets each recipient by THEIR name, not the client’s', () => {
    const tyler = buildUpdateEmail({ job, client: team[0], link: 'L', senderName: 'Raymond' });
    const sarah = buildUpdateEmail({ job, client: team[1], link: 'L', senderName: 'Raymond' });

    expect(tyler.text.startsWith('Hi Tyler,')).toBe(true);
    // The project manager must not be greeted as her boss.
    expect(sarah.text.startsWith('Hi Sarah,')).toBe(true);
    expect(sarah.text).not.toContain('Hi Tyler');
  });

  it('addresses each email to that person', () => {
    expect(buildUpdateEmail({ job, client: team[1], link: 'L' }).to)
      .toBe('sarah@breatheeasyremodeling.com');
  });

  it('falls back to a plain greeting for a nameless shared inbox', () => {
    // office@… has no person behind it — "Hi ," would look broken.
    const e = buildUpdateEmail({ job, client: team[2], link: 'L' });
    expect(e.text.startsWith('Hi,')).toBe(true);
    expect(e.to).toBe('office@breatheeasyremodeling.com');
  });

  it('every recipient sees the same project and the same status', () => {
    const bodies = team.map((c) => buildUpdateEmail({ job, client: c, link: 'L' }));
    for (const e of bodies) {
      expect(e.subject).toBe('Update on 542 Valley St');
      expect(e.text).toContain('We’re preparing your construction drawings.');
    }
  });
});

describe('each person gets their OWN link (the reason this matters)', () => {
  it('two recipients never share a token', () => {
    // A shared link would mean that when a developer's PM leaves the firm you'd have to
    // revoke the whole team and re-send. Per-person links mean you revoke that one person.
    const links = team.map(() => mintToken());
    expect(new Set(links).size).toBe(team.length);
  });

  it('each link carries a different credential into the email', () => {
    const emails = team.map((c) =>
      buildUpdateEmail({ job, client: c, link: `https://x/enter?t=${mintToken()}` }));
    const tokens = emails.map((e) => e.text.match(/enter\?t=([\w-]+)/)[1]);
    expect(new Set(tokens).size).toBe(team.length);
  });

  it('tokens are stored hashed, so one person’s link can’t be recovered and re-sent', () => {
    const t = mintToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(t);
  });
});
