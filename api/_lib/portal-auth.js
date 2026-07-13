// Shared identity + isolation for every client-portal endpoint.
//
// TWO identity paths, checked in this order:
//   1. Portal session cookie — a CLIENT who arrived via a magic link. No Clerk
//      account exists for them (Clerk is staff-only Google sign-in); the signed
//      cookie carries their client id. See portal-session.js for why.
//   2. Clerk session — staff, plus any client historically linked to a Clerk user.
//
// Job access is scoped by client_id either way. This is the one place portal
// authorization lives, so /api/portal/* routes can never diverge on who-sees-what.
import { hasClerk, getUserId, getUserEmail } from './clerk.js';
import { getDb, hasDb } from './db.js';
import { SESSION_COOKIE, readCookie, verifySession } from './portal-session.js';

const STAFF_EMAIL_DOMAIN = 'rm117.com';
const isStaffEmail = (email) => Boolean(email && email.endsWith('@' + STAFF_EMAIL_DOMAIN));

const CLIENT_COLS = 'id, name, email, type, company, clerk_user_id, is_active';

// Resolve a client from the magic-link session cookie. Returns null when there's no
// cookie, the signature/expiry fails, or the client is gone/deactivated — in which
// case the caller falls through to the Clerk path (so staff are never affected).
async function identityFromCookie(req) {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;

  const session = verifySession(raw);
  if (!session || !hasDb()) return null;

  const db = getDb();
  const { data: client } = await db
    .from('clients')
    .select(CLIENT_COLS)
    .eq('id', session.clientId)
    .maybeSingle();

  // Deactivating a client immediately kills their portal session.
  if (!client || client.is_active === false) return null;
  return { role: 'client', client, db };
}

// Returns one of:
//   { unauthorized: true }                  -> caller should 401
//   { role: 'client', client, db }          -> authenticated client
//   { role: 'staff' } | { role: 'none' }    -> not a portal client
export async function resolvePortalIdentity(req) {
  const viaCookie = await identityFromCookie(req);
  if (viaCookie) return viaCookie;

  if (!hasClerk()) return { role: 'none', reason: 'clerk_not_configured' };

  const userId = await getUserId(req);
  if (!userId) return { unauthorized: true };

  const email = await getUserEmail(userId); // lowercased, verified primary

  if (!hasDb()) return { role: isStaffEmail(email) ? 'staff' : 'none' };
  const db = getDb();

  const cols = CLIENT_COLS;
  let client = (await db.from('clients').select(cols).eq('clerk_user_id', userId).maybeSingle()).data || null;

  if (!client && email) {
    client = (await db.from('clients').select(cols).ilike('email', email).maybeSingle()).data || null;
    if (client && !client.clerk_user_id) {
      await db.from('clients').update({ clerk_user_id: userId }).eq('id', client.id);
    }
  }

  // db is returned for staff too, so staff-only actions (portal preview, file
  // access for any job) can query without re-resolving.
  if (!client || client.is_active === false) return { role: isStaffEmail(email) ? 'staff' : 'none', db, email };
  return { role: 'client', client, db };
}

// Fetch a single job ONLY if it belongs to this client. Never trust a job_id
// from the request without this check. Returns the job row or null.
export async function getClientJob(db, clientId, jobId, columns = 'job_id, drive_files_sent_folder_id') {
  if (!jobId) return null;
  const { data } = await db
    .from('jobs')
    .select(columns)
    .eq('client_id', clientId)
    .eq('job_id', jobId)
    .maybeSingle();
  return data || null;
}

// Resolve a job for the caller: a client may only reach their own jobs; staff
// may reach any job (used by the staff-side portal preview / file viewing).
export async function getJobForIdentity(identity, jobId, columns = 'job_id, drive_files_sent_folder_id') {
  if (!jobId || !identity?.db) return null;
  if (identity.role === 'client') return getClientJob(identity.db, identity.client.id, jobId, columns);
  if (identity.role === 'staff') {
    const { data } = await identity.db.from('jobs').select(columns).eq('job_id', jobId).maybeSingle();
    return data || null;
  }
  return null;
}
