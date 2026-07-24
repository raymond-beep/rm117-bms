import { describe, it, expect, beforeAll } from 'vitest';
import {
  normalizeEmail,
  mintCode,
  hashCode,
  codeMatches,
  codeExpiry,
  isCodeUsable,
  isRateLimited,
  buildLoginCodeEmail,
  CODE_LENGTH,
  MAX_ATTEMPTS,
  MAX_REQUESTS_PER_WINDOW,
  CODE_TTL_MINUTES,
} from '../api/_lib/portal-login-code.js';
import { shouldShowClientLogin } from '../src/components/shell/portal-login.jsx';

beforeAll(() => {
  process.env.PORTAL_SESSION_SECRET = 'test-secret-do-not-use-in-prod';
});

const MINUTE = 60_000;

describe('email normalization', () => {
  // client_contacts is unique on (client_id, lower(email)), so login has to fold case the
  // same way — otherwise a contact stored as "Tyler@X.com" could never sign in.
  it('folds case and trims, matching the contacts index', () => {
    expect(normalizeEmail('  Tyler@Example.COM ')).toBe('tyler@example.com');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('code minting', () => {
  it('always produces exactly 6 digits, including leading zeros', () => {
    for (let i = 0; i < 400; i++) {
      const code = mintCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(CODE_LENGTH);
    }
  });

  it('does not return a constant', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintCode()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('code hashing', () => {
  it('round-trips the right code and rejects the wrong one', () => {
    const hash = hashCode('a@b.com', '123456');
    expect(codeMatches('a@b.com', '123456', hash)).toBe(true);
    expect(codeMatches('a@b.com', '123457', hash)).toBe(false);
  });

  it('is case-insensitive on the email, like the lookup is', () => {
    const hash = hashCode('A@B.com', '123456');
    expect(codeMatches('a@b.com', '123456', hash)).toBe(true);
  });

  // The load-bearing property: the stored value must be worthless without the server secret.
  // A plain sha256 of a 6-digit code falls to a full sweep of 1,000,000 candidates instantly.
  it('is keyed by the server secret, not a bare digest', async () => {
    const hash = hashCode('a@b.com', '123456');
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update('123456').digest('hex');
    expect(hash).not.toBe(plain);
    expect(hash).not.toBe(createHash('sha256').update('a@b.com:123456').digest('hex'));
  });

  it('binds the email in, so a hash cannot be replayed for another address', () => {
    const hash = hashCode('a@b.com', '123456');
    expect(codeMatches('someone-else@b.com', '123456', hash)).toBe(false);
  });

  it('fails closed on a malformed or missing stored hash', () => {
    expect(codeMatches('a@b.com', '123456', null)).toBe(false);
    expect(codeMatches('a@b.com', '123456', '')).toBe(false);
    expect(codeMatches('a@b.com', '123456', 'short')).toBe(false);
  });
});

describe('code usability', () => {
  const live = () => ({ expires_at: new Date(Date.now() + 5 * MINUTE).toISOString(), attempts: 0, consumed_at: null });

  it('accepts a fresh, unused, unexpired code', () => {
    expect(isCodeUsable(live())).toBe(true);
  });

  it('rejects a code that was already used — single use', () => {
    expect(isCodeUsable({ ...live(), consumed_at: new Date().toISOString() })).toBe(false);
  });

  it('rejects an expired code', () => {
    expect(isCodeUsable({ ...live(), expires_at: new Date(Date.now() - MINUTE).toISOString() })).toBe(false);
  });

  // This cap — not the length — is what makes 6 digits safe. Without it, a million guesses
  // is an afternoon's work.
  it('rejects a code once the attempt cap is reached', () => {
    expect(isCodeUsable({ ...live(), attempts: MAX_ATTEMPTS - 1 })).toBe(true);
    expect(isCodeUsable({ ...live(), attempts: MAX_ATTEMPTS })).toBe(false);
    expect(isCodeUsable({ ...live(), attempts: MAX_ATTEMPTS + 3 })).toBe(false);
  });

  it('rejects nothing at all, rather than throwing', () => {
    expect(isCodeUsable(null)).toBe(false);
    expect(isCodeUsable({})).toBe(false);
  });
});

describe('request throttling', () => {
  const ago = (min) => ({ created_at: new Date(Date.now() - min * MINUTE).toISOString() });

  it('allows a client who fumbles a few times', () => {
    expect(isRateLimited([ago(1), ago(2)])).toBe(false);
    expect(isRateLimited([])).toBe(false);
  });

  it('stops a burst that could mailbomb an address', () => {
    expect(isRateLimited(Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ago(1)))).toBe(true);
  });

  it('lets old requests fall out of the window', () => {
    expect(isRateLimited(Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ago(60)))).toBe(false);
  });
});

describe('the code email', () => {
  it('leads with the code and says how long it lasts', () => {
    const { subject, text } = buildLoginCodeEmail({ code: '482917', name: 'Tyler Deuel' });
    expect(subject).toContain('482917');
    expect(text).toContain('482917');
    expect(text).toContain('Hi Tyler,');
    expect(text).toContain(`${CODE_TTL_MINUTES} minutes`);
  });

  it('greets a client with no name on file without saying "Hi undefined"', () => {
    expect(buildLoginCodeEmail({ code: '000123' }).text).toContain('Hi,');
  });

  // A login-code email that also contained a way in would just be a magic link with extra
  // steps — and would undo the point of asking for the code at all.
  it('carries no link and no project detail', () => {
    const { text } = buildLoginCodeEmail({ code: '482917', name: 'Tyler' });
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe('which sign-in door renders', () => {
  // Staff and clients share one Vercel deployment. Getting this wrong either locks clients
  // out (staff Google screen) or hides the staff app — so it is pinned here.
  it('gives clients the code login on the portal hostname', () => {
    expect(shouldShowClientLogin({ hostname: 'portal.rm117.com', pathname: '/' })).toBe(true);
  });

  it('leaves the staff Clerk screen alone on the app hostname', () => {
    expect(shouldShowClientLogin({ hostname: 'rm117-bms.vercel.app', pathname: '/' })).toBe(false);
    expect(shouldShowClientLogin({ hostname: 'localhost', pathname: '/' })).toBe(false);
  });

  it('honours /login so the page is reachable in local dev', () => {
    expect(shouldShowClientLogin({ hostname: 'localhost', pathname: '/login' })).toBe(true);
  });

  it('lets a staffer on the portal host escape to Clerk with ?staff=1', () => {
    expect(shouldShowClientLogin({ hostname: 'portal.rm117.com', pathname: '/', search: '?staff=1' })).toBe(false);
  });

  // The query string only exists on the first URL. Without a sticky override, a staffer who
  // signed in via ?staff=1 would be thrown back to the client login on their next click.
  it('keeps the staff door open after the query string is gone', () => {
    expect(shouldShowClientLogin({ hostname: 'portal.rm117.com', pathname: '/bms', staffOverride: true })).toBe(false);
  });

  it('still shows clients the code login when no override is set', () => {
    expect(shouldShowClientLogin({ hostname: 'portal.rm117.com', pathname: '/bms', staffOverride: false })).toBe(true);
  });
});

describe('expiry', () => {
  it('defaults to the documented TTL', () => {
    const now = Date.now();
    const iso = codeExpiry(undefined, now);
    expect(new Date(iso).getTime()).toBe(now + CODE_TTL_MINUTES * MINUTE);
  });
});
