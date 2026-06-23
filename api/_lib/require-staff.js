// Staff-only API gate (shared). Use at the top of every endpoint that returns or
// mutates internal firm data (jobs, clients, payments, forefront, phase events,
// field notes). Closes the pre-2026-06-21 hole where these APIs were fully
// unauthenticated — anyone with the URL could pull the firm's whole book of
// business.
//
// Why staff-only and not just "any valid token": portal *clients* also sign in
// via Clerk, so a valid session alone isn't enough — we require an RM117 staff
// identity (an @rm117.com email). Clients are scoped to the portal's own
// endpoint (api/portal/[action].js), never these.
//
// Returns the Clerk user id on success. On failure it sends the response and
// returns null, so callers do: `if (!(await requireStaff(req, res))) return;`
//   401 — no / invalid Clerk session token
//   403 — a valid session, but not an RM117 staff account
// When Clerk isn't configured (pure local/offline mock), allows a 'local-dev'
// user so the app still runs without auth wired up.
import { hasClerk, getUserId, getUserEmail } from './clerk.js';

const STAFF_DOMAIN = '@rm117.com';

export async function requireStaff(req, res) {
  if (!hasClerk()) return 'local-dev';

  const userId = await getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  const email = await getUserEmail(userId);
  if (!email || !email.endsWith(STAFF_DOMAIN)) {
    res.status(403).json({ error: 'Staff access required' });
    return null;
  }

  return userId;
}
