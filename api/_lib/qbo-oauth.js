// QuickBooks Online OAuth2 — authorization-code flow (one-time connect / reconnect).
//
// This is the *seeding* counterpart to api/_lib/qbo.js (which does the ongoing
// refresh-token → access-token dance). A staff admin runs this once to authorize
// the app against the real QuickBooks company; the flow returns the seed
// QBO_REFRESH_TOKEN. It's also the "reconnect path" promised in the Intuit
// Compliance questionnaire — re-run it any time invalid_grant kills the token.
//
// CSRF: the `state` param is HMAC-signed here and verified on the callback, so a
// forged callback can't trick us into exchanging an attacker's code. The two
// routes are separate stateless invocations, so state is self-contained (signed
// payload), not stored server-side.

import crypto from 'crypto';

export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
// Accounting API only (create invoices/customers, read payment status). No
// payments/money-movement scope — matches what we told Intuit's review.
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ── Signed state (CSRF) ───────────────────────────────────────────────────────
// state = base64url(JSON{nonce, ts}) + '.' + base64url(HMAC_SHA256(secret, payload))
export function makeState(secret, now = Date.now()) {
  if (!secret) throw new Error('makeState: a signing secret is required');
  const payload = b64url(JSON.stringify({ n: crypto.randomBytes(12).toString('hex'), t: now }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

// Returns true only for an intact signature that's within maxAgeMs. Uses a
// constant-time compare so a partial-match can't be timed out.
export function verifyState(secret, state, maxAgeMs = 15 * 60 * 1000, now = Date.now()) {
  if (!secret || typeof state !== 'string' || !state.includes('.')) return false;
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return false;
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof t !== 'number') return false;
    return now - t >= 0 && now - t <= maxAgeMs;
  } catch {
    return false;
  }
}

// ── Authorize URL ─────────────────────────────────────────────────────────────
export function buildAuthorizeUrl({ clientId, redirectUri, state, scope = QBO_SCOPE }) {
  if (!clientId) throw new Error('buildAuthorizeUrl: clientId is required');
  if (!redirectUri) throw new Error('buildAuthorizeUrl: redirectUri is required');
  const qs = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${qs.toString()}`;
}

// ── Code → tokens exchange ────────────────────────────────────────────────────
// Returns { access_token, refresh_token, expires_in, x_refresh_token_expires_in }.
export async function exchangeCodeForTokens({ clientId, clientSecret, code, redirectUri }) {
  if (!clientId || !clientSecret) throw new Error('exchangeCodeForTokens: missing client credentials');
  if (!code) throw new Error('exchangeCodeForTokens: authorization code is required');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const tid = resp.headers.get('intuit_tid');
    throw new Error(`QBO code exchange failed (${resp.status}${tid ? `, tid ${tid}` : ''}): ${text}`);
  }
  return JSON.parse(text);
}

// Build the callback redirect URI from the incoming request, so the same code
// works on localhost (http) and the deployed app (https) without hardcoding.
// Both must be registered as redirect URIs in the Intuit app settings.
export function callbackUriFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/qbo/callback`;
}

// Is this request coming in over localhost? (Lets the local dev mint skip the
// shared-key guard while the deployed reconnect route still requires it.)
export function isLocalhostReq(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}
