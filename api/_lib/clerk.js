// Clerk backend helper (Phase 0 — Gmail/Calendar OAuth).
// Verifies the caller's Clerk session token and fetches the per-user Google
// OAuth access token that Clerk stores when the user connects Google with the
// gmail.readonly scope. Server-side only — never expose CLERK_SECRET_KEY.
//
// Returns structured errors (never throws for the expected "not connected" path)
// so the API can respond with a clean state the UI knows how to render.
import { createClerkClient, verifyToken } from '@clerk/backend';

let _clerk = null;

export function hasClerk() {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return _clerk;
}

// Verify the Bearer token on the request and return the Clerk user id (sub).
// Returns null when missing/invalid — caller should respond 401.
export async function getUserId(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    return claims.sub || null;
  } catch {
    return null;
  }
}

// Fetch the user's Google OAuth access token from Clerk.
// Clerk v5 provider id is "oauth_google"; older instances used "google".
// Returns { token } or { error: 'google_not_connected' }.
export async function getGoogleToken(userId) {
  let lastErr = null;
  for (const provider of ['oauth_google', 'google']) {
    try {
      const res = await clerk().users.getUserOauthAccessToken(userId, provider);
      const list = Array.isArray(res) ? res : res?.data;
      const token = list?.[0]?.token;
      if (token) return { token };
    } catch (e) {
      const detail = e?.errors?.[0]?.message || e?.errors?.[0]?.code || e?.message || String(e);
      lastErr = `s=${e?.status} ${detail}`;
    }
  }
  return { error: 'google_not_connected', detail: lastErr };
}
