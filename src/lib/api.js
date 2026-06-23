// apiFetch — fetch wrapper that attaches the signed-in staff member's Clerk
// session token. The staff data APIs (/api/jobs, /api/clients, /api/forefront,
// /api/payments, /api/phase-events, /api/jobs/*) are now staff-gated
// (api/_lib/require-staff.js), so calls must carry a Bearer token.
//
// The token is read from the global Clerk instance the ClerkProvider installs on
// `window`, so call sites don't each need the useAuth() hook. These endpoints are
// only ever called from inside the signed-in staff shell, so the session is
// present by the time they run. If Clerk isn't ready / there's no session, no
// header is sent and the API replies 401 — which every caller already handles.
export async function apiFetch(url, options = {}) {
  let token = null;
  try {
    token = await window.Clerk?.session?.getToken();
  } catch {
    /* Clerk not ready or no active session — fall through to an unauthed call */
  }
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}
