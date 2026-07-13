import { describe, it, expect, beforeAll } from 'vitest';
import {
  mintToken,
  hashToken,
  linkExpiry,
  isLinkUsable,
  signSession,
  verifySession,
  readCookie,
  sessionCookies,
  clearCookies,
  SESSION_COOKIE,
  HINT_COOKIE,
} from '../api/_lib/portal-session.js';

beforeAll(() => {
  process.env.PORTAL_SESSION_SECRET = 'test-secret-do-not-use-in-prod';
});

describe('link tokens', () => {
  it('mints unguessable, unique tokens', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('stores only a hash — the raw token is not recoverable from it', () => {
    const token = mintToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash); // deterministic → lookup by hash works
  });
});

describe('isLinkUsable', () => {
  const now = Date.now();
  const future = new Date(now + 86_400_000).toISOString();
  const past = new Date(now - 86_400_000).toISOString();

  it('accepts a live link', () => {
    expect(isLinkUsable({ expires_at: future, revoked_at: null }, now)).toBe(true);
  });

  it('rejects an expired link', () => {
    expect(isLinkUsable({ expires_at: past, revoked_at: null }, now)).toBe(false);
  });

  it('rejects a revoked link even when unexpired', () => {
    expect(isLinkUsable({ expires_at: future, revoked_at: past }, now)).toBe(false);
  });

  it('rejects a missing link (no such token)', () => {
    expect(isLinkUsable(null, now)).toBe(false);
    expect(isLinkUsable(undefined, now)).toBe(false);
  });

  it('linkExpiry lands in the future', () => {
    expect(new Date(linkExpiry(60, now)).getTime()).toBeGreaterThan(now);
  });
});

describe('session cookie', () => {
  it('round-trips a client id', () => {
    const s = signSession('client-123');
    expect(verifySession(s)?.clientId).toBe('client-123');
  });

  it('rejects a tampered payload (forged client id)', () => {
    const s = signSession('client-123');
    const [, sig] = s.split('.');
    const forged = `${Buffer.from(JSON.stringify({ c: 'someone-else', e: Date.now() + 1e6 })).toString('base64url')}.${sig}`;
    expect(verifySession(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const s = signSession('client-123');
    expect(verifySession(`${s.split('.')[0]}.deadbeef`)).toBeNull();
  });

  it('rejects an expired session', () => {
    const now = Date.now();
    const s = signSession('client-123', { now: now - 40 * 86_400_000, days: 30 });
    expect(verifySession(s, now)).toBeNull();
  });

  it('rejects malformed junk without throwing', () => {
    for (const bad of [null, undefined, '', 'nodot', '.', 'a.b.c', 123, {}]) {
      expect(verifySession(bad)).toBeNull();
    }
  });

  it('a session signed under a different secret does not verify', () => {
    const s = signSession('client-123');
    const original = process.env.PORTAL_SESSION_SECRET;
    process.env.PORTAL_SESSION_SECRET = 'a-different-secret';
    expect(verifySession(s)).toBeNull();
    process.env.PORTAL_SESSION_SECRET = original;
  });
});

describe('cookie plumbing', () => {
  it('reads only the named cookie', () => {
    const req = { headers: { cookie: `foo=bar; ${SESSION_COOKIE}=abc.def; other=1` } };
    expect(readCookie(req, SESSION_COOKIE)).toBe('abc.def');
    expect(readCookie(req, 'missing')).toBeNull();
  });

  it('survives a missing cookie header', () => {
    expect(readCookie({ headers: {} }, SESSION_COOKIE)).toBeNull();
    expect(readCookie({}, SESSION_COOKIE)).toBeNull();
  });

  it('marks the credential HttpOnly and the hint readable', () => {
    const [session, hint] = sessionCookies('sess-value', { secure: true });
    expect(session).toContain(`${SESSION_COOKIE}=sess-value`);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
    expect(hint).toContain(`${HINT_COOKIE}=1`);
    expect(hint).not.toContain('HttpOnly'); // the SPA must be able to read it
  });

  it('omits Secure on localhost so dev works over http', () => {
    expect(sessionCookies('s', { secure: false })[0]).not.toContain('Secure');
  });

  it('clearing expires both cookies', () => {
    const [session, hint] = clearCookies({ secure: true });
    expect(session).toContain('Max-Age=0');
    expect(hint).toContain('Max-Age=0');
  });
});
