// Client-portal magic-link auth — the crypto half, kept pure + testable.
//
// WHY this exists alongside Clerk: staff sign in with Google through Clerk. Clients
// must not. A homeowner won't keep a password and a developer won't tolerate one —
// but both will click a link in an email. So the link IS the login:
//
//   1. Staff mint a link for a client  -> a 256-bit token; only its SHA-256 hash is
//      stored (`portal_links.token_hash`), so a DB leak yields no usable links.
//   2. The client clicks it            -> /api/portal/enter validates the token,
//      exchanges it for a signed session cookie, and strips the token from the URL.
//   3. Every later request              -> the cookie identifies the client.
//
// The cookie is HMAC-signed (not encrypted): it carries no secrets, only a client id
// and an expiry, and a forged one fails the signature check. The portal payload is
// deliberately money-free, and job access is still filtered by client_id server-side
// (see getClientJob), so a leaked link exposes one client's own status + documents —
// never anyone else's, and never financials.
import crypto from 'node:crypto';

const TOKEN_BYTES = 32; // 256-bit
export const SESSION_COOKIE = 'rm117_portal_session'; // HttpOnly — the credential
export const HINT_COOKIE = 'rm117_portal'; // readable — lets the SPA skip Clerk

export const DEFAULT_LINK_TTL_DAYS = 60;
export const SESSION_TTL_DAYS = 30;

const DAY_MS = 86_400_000;

// Server-only secret. PORTAL_SESSION_SECRET is preferred; fall back to the Supabase
// service key so the feature works without a new env var (both are server-only and
// never shipped to the browser). Resolved per call so tests can set it.
function sessionSecret() {
  const s = process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('portal session secret not configured');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------- link tokens ----------

// The raw token goes in the email link and is never persisted.
export function mintToken() {
  return b64url(crypto.randomBytes(TOKEN_BYTES));
}

// Only the hash is stored, so the DB never holds a working credential.
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function linkExpiry(days = DEFAULT_LINK_TTL_DAYS, now = Date.now()) {
  return new Date(now + days * DAY_MS).toISOString();
}

// A link is usable only if it exists, wasn't revoked, and hasn't expired.
export function isLinkUsable(row, now = Date.now()) {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() > now;
}

// ---------- session cookie ----------

const sign = (payload) => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

// `<base64url({c,e})>.<hmac>` — c = client id, e = expiry (epoch ms).
export function signSession(clientId, { now = Date.now(), days = SESSION_TTL_DAYS } = {}) {
  const payload = b64url(JSON.stringify({ c: String(clientId), e: now + days * DAY_MS }));
  return `${payload}.${sign(payload)}`;
}

// Returns { clientId, expiresAt } or null. Null on ANY doubt: malformed, bad
// signature, or expired. Signature is compared in constant time.
export function verifySession(value, now = Date.now()) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = value.slice(0, dot);
  const provided = value.slice(dot + 1);

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null; // secret missing — fail closed
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims?.c || typeof claims.e !== 'number') return null;
  if (claims.e <= now) return null;

  return { clientId: claims.c, expiresAt: claims.e };
}

// ---------- cookie plumbing ----------

// Minimal parser — we only ever read our own two cookies.
export function readCookie(req, name) {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// The signed credential is HttpOnly (JS can't read it). The hint cookie is
// deliberately readable: it lets the SPA know "a portal session may exist" and skip
// the Clerk sign-in screen, without exposing anything sensitive.
export function sessionCookies(session, { secure = true, days = SESSION_TTL_DAYS } = {}) {
  const maxAge = Math.floor((days * DAY_MS) / 1000);
  const flags = `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
  return [
    `${SESSION_COOKIE}=${session}; HttpOnly; ${flags}`,
    `${HINT_COOKIE}=1; ${flags}`,
  ];
}

export function clearCookies({ secure = true } = {}) {
  const flags = `Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
  return [`${SESSION_COOKIE}=; HttpOnly; ${flags}`, `${HINT_COOKIE}=; ${flags}`];
}
