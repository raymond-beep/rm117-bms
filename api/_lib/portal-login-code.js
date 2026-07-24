// Client portal: email + code login — the crypto and policy half, kept pure + testable.
//
// WHY this exists alongside the magic link. The link stays: it rides along in the update
// email, it is one click, and killing "any update?" emails is the portal's entire job. But a
// link is only a way IN if you still have the email. This is the front door for everyone
// else — the client goes to portal.rm117.com, types their address, gets a 6-digit code, and
// lands in exactly the same portal. Both doors mint the SAME session (signSession), so there
// is no second authorization path to keep in step.
//
//   1. Client submits an email  -> matched against ACTIVE client_contacts
//   2. A 6-digit code is mailed -> only its HMAC is stored (see below)
//   3. Client submits the code  -> exchanged for the normal portal session cookie
//
// ⚠️ THE HASH IS AN HMAC, NOT A DIGEST — do not "simplify" this to sha256().
// portal_links can store a plain sha256 because its token is 256 bits and a stolen hash is
// not invertible. A 6-digit code has only 1,000,000 possibilities: a plain digest of one
// falls to exhaustive search instantly from a DB dump. Keying the hash with the server
// secret means the stored value is worthless to anyone who does not also hold that secret.
//
// ⚠️ SIX DIGITS IS NOT WHAT MAKES THIS SAFE — the attempt cap is. A code dies after
// MAX_ATTEMPTS wrong guesses and after CODE_TTL_MINUTES. Without the cap, a million guesses
// is a trivial online attack. If you ever relax MAX_ATTEMPTS, lengthen the code to match.
import crypto from 'node:crypto';

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

// Throttle: how many codes one address may request before it has to wait. Generous enough
// that a client who fumbles ("did it send?") is never locked out, tight enough that this
// endpoint can't be used to mailbomb someone.
export const MAX_REQUESTS_PER_WINDOW = 5;
export const REQUEST_WINDOW_MINUTES = 15;

const MINUTE_MS = 60_000;

// Same secret source as the session cookie: PORTAL_SESSION_SECRET preferred, falling back to
// the Supabase service key so no new env var is required. Both are server-only. Resolved per
// call so tests can set it.
function codeSecret() {
  const s = process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('portal session secret not configured');
  return s;
}

// "  Tyler@Example.COM " and "tyler@example.com" are one person. client_contacts already
// enforces this with a lower(email) unique index — match it exactly or a contact who typed
// their address with a capital letter can't log in.
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

// A uniform 6-digit code. crypto.randomInt is rejection-sampled internally, so this carries
// no modulo bias — `randomBytes % 1000000` would very slightly favour low codes.
export function mintCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

// HMAC-SHA256(secret, email + code). The email is bound in so a hash lifted from one row
// can't be replayed against a different address.
export function hashCode(email, code) {
  return crypto
    .createHmac('sha256', codeSecret())
    .update(`${normalizeEmail(email)}:${String(code ?? '').trim()}`)
    .digest('hex');
}

// Constant-time comparison — a timing side channel here would leak the code digit by digit.
export function codeMatches(email, submitted, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  let expected;
  try {
    expected = hashCode(email, submitted);
  } catch {
    return false; // secret missing — fail closed
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function codeExpiry(minutes = CODE_TTL_MINUTES, now = Date.now()) {
  return new Date(now + minutes * MINUTE_MS).toISOString();
}

// A code is usable only if it exists, was never used, hasn't burned its attempts, and
// hasn't expired. Mirrors isLinkUsable — same shape, same fail-closed posture.
export function isCodeUsable(row, now = Date.now()) {
  if (!row) return false;
  if (row.consumed_at) return false;
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) return false;
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() > now;
}

// Has this address asked for too many codes lately? `rows` is the recent request history for
// one email (newest first is fine; order doesn't matter).
export function isRateLimited(rows, now = Date.now()) {
  const cutoff = now - REQUEST_WINDOW_MINUTES * MINUTE_MS;
  const recent = (rows || []).filter((r) => new Date(r.created_at).getTime() > cutoff);
  return recent.length >= MAX_REQUESTS_PER_WINDOW;
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// The email carrying the code. Deliberately short and boring: it exists to be scanned in two
// seconds on a phone. No project detail, no money, no link — a login code email that also
// contains a way in would just be a magic link with extra steps.
export function buildLoginCodeEmail({ code, name } = {}) {
  const hi = firstName(name);
  const lines = [];
  lines.push(hi ? `Hi ${hi},` : 'Hi,');
  lines.push('');
  lines.push('Here is your sign-in code for the Room 117 project portal:');
  lines.push('');
  lines.push(String(code));
  lines.push('');
  lines.push(`It expires in ${CODE_TTL_MINUTES} minutes and can only be used once.`);
  lines.push('');
  lines.push("If you didn't ask to sign in, you can ignore this email — nobody can get in without the code.");
  lines.push('');
  lines.push('Room 117 Architecture & Design');

  return {
    subject: `Your sign-in code: ${code}`,
    text: lines.join('\n'),
  };
}
