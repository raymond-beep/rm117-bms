// Client-portal password crypto + policy — pure, no db/network, so it's unit-tested
// without a database. The portal's optional third door (email + password), alongside
// the magic link and the 6-digit code. See migration 0019 and PORTAL_LOGIN.md.
//
// ⚠️ Hashing is scrypt from Node's own `crypto` — no dependency, same spirit as the
// HMAC in portal-login-code.js. A password is stored ONLY as "saltHex:hashHex" and can
// never be read back. scrypt is deliberately slow + memory-hard, so a stolen hash is
// expensive to brute-force. Never swap this for a bare sha256/md5.
//
// ⚠️ Length is not what makes this safe on its own — the per-account attempt cap + lockout
// (enforced in the endpoint against portal_credentials) are. Keep them if you touch this.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
// scrypt cost. N=16384 (2^14) is the Node default and a sane interactive-login cost;
// maxmem must be raised above the default 32MB ceiling or N*r*128 overflows it.
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200; // scrypt cost scales with input; also stops abuse
export const MAX_LOGIN_ATTEMPTS = 5;    // wrong tries before a temporary lock
export const LOCK_MINUTES = 15;

// Returns an error string for the client, or null when the password is acceptable.
// Deliberately light on rules: length is what matters; arbitrary "1 symbol, 1 capital"
// requirements push people to "Password1!" and to reuse, without adding real strength.
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length === 0) return 'Please enter a password.';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return 'That password is too long.';
  return null;
}

// scrypt the password with a fresh 16-byte salt (or a provided salt, for tests).
// Returns "saltHex:hashHex" — the only thing ever stored.
export function hashPassword(password, salt = randomBytes(16)) {
  const s = typeof salt === 'string' ? Buffer.from(salt, 'hex') : salt;
  const dk = scryptSync(String(password), s, KEYLEN, PARAMS);
  return `${s.toString('hex')}:${dk.toString('hex')}`;
}

// Constant-time verify. False on any malformed stored value rather than throwing, so a
// corrupt row can't 500 a login. The scrypt work happens regardless of format, which
// helps keep timing uniform between "wrong password" and "no such user" (the caller
// verifies against a dummy hash when the account doesn't exist).
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(String(password), salt, expected.length, PARAMS);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A well-formed hash of a throwaway value. login-password verifies against THIS when the
// email has no credential, so an attacker can't tell "no account" from "wrong password"
// by timing — both do one scrypt.
export const DUMMY_HASH = hashPassword('portal-no-such-account', Buffer.alloc(16, 7));

// Is this credential row currently locked out? Pure, so it's testable.
export function isLocked(cred, now = Date.now()) {
  if (!cred?.locked_until) return false;
  return new Date(cred.locked_until).getTime() > now;
}

// Given the attempts-so-far, decide the next failed-login state: increment, and lock once
// the cap is hit. Returns { failed_attempts, locked_until } to persist.
export function nextFailureState(prevAttempts = 0, now = Date.now()) {
  const failed_attempts = (Number(prevAttempts) || 0) + 1;
  const locked_until =
    failed_attempts >= MAX_LOGIN_ATTEMPTS ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null;
  return { failed_attempts, locked_until };
}
