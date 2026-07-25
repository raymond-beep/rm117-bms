// Pure password crypto + policy for the portal's optional email+password door.
// No database — scrypt hashing, verification, strength rules, and lockout math.
import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  hashPassword,
  verifyPassword,
  isLocked,
  nextFailureState,
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  MAX_LOGIN_ATTEMPTS,
} from '../api/_lib/portal-password.js';

describe('validatePassword', () => {
  it('accepts a password at or over the minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(validatePassword('correct horse battery staple')).toBeNull();
  });
  it('rejects empty, short, and over-long', () => {
    expect(validatePassword('')).toMatch(/enter a password/i);
    expect(validatePassword('short')).toMatch(/at least/i);
    expect(validatePassword('x'.repeat(201))).toMatch(/too long/i);
  });
  it('rejects non-strings', () => {
    expect(validatePassword(undefined)).toBeTruthy();
    expect(validatePassword(12345678)).toBeTruthy();
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips the correct password', () => {
    const stored = hashPassword('hunter2-hunter2');
    expect(verifyPassword('hunter2-hunter2', stored)).toBe(true);
  });
  it('rejects the wrong password', () => {
    const stored = hashPassword('hunter2-hunter2');
    expect(verifyPassword('Hunter2-hunter2', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });
  it('never stores the plaintext and salts each hash uniquely', () => {
    const a = hashPassword('same-password-here');
    const b = hashPassword('same-password-here');
    expect(a).not.toContain('same-password-here');
    expect(a).not.toEqual(b); // different random salt => different hash
    expect(verifyPassword('same-password-here', a)).toBe(true);
    expect(verifyPassword('same-password-here', b)).toBe(true);
  });
  it('is deterministic for a fixed salt (test hook)', () => {
    const salt = '00112233445566778899aabbccddeeff';
    expect(hashPassword('abc12345', salt)).toEqual(hashPassword('abc12345', salt));
  });
  it('returns false (never throws) on a malformed stored value', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', ':')).toBe(false);
  });
  it('DUMMY_HASH is a valid hash of an unknown value (for timing-uniform misses)', () => {
    expect(DUMMY_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword('anything', DUMMY_HASH)).toBe(false);
  });
});

describe('lockout math', () => {
  const NOW = 1_000_000_000_000;

  it('is not locked with no lock set', () => {
    expect(isLocked({ locked_until: null }, NOW)).toBe(false);
    expect(isLocked({}, NOW)).toBe(false);
  });
  it('is locked while locked_until is in the future, free once it passes', () => {
    const future = new Date(NOW + 60_000).toISOString();
    const past = new Date(NOW - 60_000).toISOString();
    expect(isLocked({ locked_until: future }, NOW)).toBe(true);
    expect(isLocked({ locked_until: past }, NOW)).toBe(false);
  });
  it('increments attempts and only locks at the cap', () => {
    let s = nextFailureState(0, NOW);
    expect(s).toEqual({ failed_attempts: 1, locked_until: null });
    for (let i = 2; i < MAX_LOGIN_ATTEMPTS; i++) {
      s = nextFailureState(s.failed_attempts, NOW);
      expect(s.locked_until).toBeNull();
    }
    s = nextFailureState(MAX_LOGIN_ATTEMPTS - 1, NOW);
    expect(s.failed_attempts).toBe(MAX_LOGIN_ATTEMPTS);
    expect(s.locked_until).toBeTruthy();
    expect(new Date(s.locked_until).getTime()).toBeGreaterThan(NOW);
  });
});
