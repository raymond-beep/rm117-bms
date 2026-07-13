// Single serverless function for ALL client-portal routes, dispatched by the
// trailing path segment: /api/portal/me | /files | /download (and future
// /messages, /send, …). Consolidated into one function to stay within the
// Vercel Hobby 12-function limit and to keep portal surface area in one place.
//
// Every action goes through resolvePortalIdentity first, so client isolation is
// enforced uniformly. The portal is deliberately money-free.
import { resolvePortalIdentity, getJobForIdentity } from '../_lib/portal-auth.js';
import { hasDrive, listFolderFiles, getFileMeta, streamFileTo, resolveFilesSentFolderId } from '../_lib/google-drive.js';
import { requireStaff } from '../_lib/require-staff.js';
import { getDb, hasDb, computeOutstanding } from '../_lib/db.js';
import {
  mintToken,
  hashToken,
  linkExpiry,
  isLinkUsable,
  signSession,
  sessionCookies,
  clearCookies,
  DEFAULT_LINK_TTL_DAYS,
} from '../_lib/portal-session.js';

function group(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

// Allowed HTTP method per action (everything is GET except posting a message).
const METHODS = {
  me: 'GET',
  preview: 'GET',
  files: 'GET',
  download: 'GET',
  messages: 'GET',
  send: 'POST',
  enter: 'GET',   // magic-link landing — PUBLIC by design (it IS the authentication)
  signout: 'GET', // clears the portal cookies
  invite: 'POST', // STAFF-only — mint a magic link for a client
  links: 'GET',   // STAFF-only — list a client's live links
  revoke: 'POST', // STAFF-only — kill a link
};

// Actions that must NOT go through resolvePortalIdentity: `enter` is how a client
// becomes authenticated in the first place, and `signout` must work even once the
// cookie is stale. Everything else is gated.
const PUBLIC_ACTIONS = new Set(['enter', 'signout']);

// Staff-only actions are gated by requireStaff (Clerk), not the portal identity —
// minting/revoking a client's access is a staff operation.
const STAFF_ACTIONS = new Set(['invite', 'links', 'revoke']);

// Cookies need Secure in production; localhost dev is plain http.
const isSecureReq = (req) =>
  (req.headers['x-forwarded-proto'] || '').includes('https') ||
  !/^localhost|^127\.0\.0\.1/.test(req.headers.host || '');

export default async function handler(req, res) {
  // On Vercel the dynamic segment arrives as req.query.action; locally we derive
  // it from the URL so the same file serves both.
  const action = req.query?.action || new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).pop();

  const allowed = METHODS[action];
  if (!allowed) return res.status(404).json({ error: 'unknown_action' });
  if (req.method !== allowed) return res.status(405).json({ error: 'Method not allowed' });

  // The magic-link landing + signout run before any identity exists.
  if (PUBLIC_ACTIONS.has(action)) {
    return action === 'enter' ? handleEnter(req, res) : handleSignout(req, res);
  }

  // Minting/revoking client access is a staff operation, gated by Clerk.
  if (STAFF_ACTIONS.has(action)) {
    const staff = await requireStaff(req, res); // sends 401/403 itself
    if (!staff) return undefined;
    if (action === 'invite') return handleInvite(req, res, staff);
    if (action === 'links') return handleLinks(req, res);
    return handleRevoke(req, res);
  }

  const identity = await resolvePortalIdentity(req);
  if (identity.unauthorized) return res.status(401).json({ error: 'unauthorized' });

  switch (action) {
    case 'me':
      return handleMe(req, res, identity);
    case 'preview':
      return handlePreview(req, res, identity);
    case 'files':
      return handleFiles(req, res, identity);
    case 'download':
      return handleDownload(req, res, identity);
    case 'messages':
      return handleMessages(req, res, identity);
    case 'send':
      return handleSend(req, res, identity);
    default:
      return res.status(404).json({ error: 'unknown_action' });
  }
}

// Build the portal payload for one client id.
//
// MONEY: the portal used to be deliberately money-free. It now carries each job's
// contracted total, paid-to-date and outstanding balance — a decision taken because a
// client (especially a developer running several jobs) genuinely wants to know what they
// owe, and because a large share of the firm's receivables sit 90+ days out. Only the
// three summary figures cross the wire — never the payment records, the Forefront
// commission, or anything about another client's job.
async function buildPortalJobs(db, clientId) {
  const { data: jobs = [], error } = await db
    .from('jobs')
    .select('job_id, client_name, address, phase, phase_override, job_total, next_milestone_label, next_milestone_date, created_at, updated_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const jobIds = jobs.map((j) => j.job_id);
  const { data: events = [] } = jobIds.length
    ? await db.from('job_phase_events').select('job_id, phase, entered_at').in('job_id', jobIds).order('entered_at', { ascending: true })
    : { data: [] };
  const evByJob = group(events, 'job_id');

  // Payments are summed server-side; the individual rows never leave the server.
  const { data: payments = [] } = jobIds.length
    ? await db.from('payments').select('job_id, amount').in('job_id', jobIds)
    : { data: [] };
  const payByJob = group(payments, 'job_id');

  return jobs.map((j) => {
    const timeline = (evByJob.get(j.job_id) || []).map((e) => ({ phase: e.phase, at: e.entered_at }));
    const lastEventAt = timeline.length ? timeline[timeline.length - 1].at : null;
    const jobPayments = payByJob.get(j.job_id) || [];
    const total = Number(j.job_total || 0);
    const paid = jobPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const outstanding = computeOutstanding(j, jobPayments);
    return {
      job_id: j.job_id,
      title: j.client_name || j.job_id,
      address: j.address || null,
      phase: j.phase,
      phase_override: j.phase_override || null,
      next_milestone_label: j.next_milestone_label || null,
      next_milestone_date: j.next_milestone_date || null,
      last_update: lastEventAt || j.updated_at || j.created_at,
      timeline,
      // A job with no contracted total yet (a fresh proposal) shows no money at all,
      // rather than a misleading $0 balance.
      billing: total > 0 ? { total, paid, outstanding } : null,
    };
  });
}

// GET /api/portal/me — the authenticated client's own jobs.
async function handleMe(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'client') return res.status(200).json({ role: identity.role });
  const { client, db } = identity;
  const jobs = await buildPortalJobs(db, client.id);
  return res.status(200).json({
    role: 'client',
    client: { name: client.name, email: client.email, type: client.type, company: client.company || null },
    jobs,
  });
}

// GET /api/portal/preview?client_id=... — STAFF ONLY. Render any client's portal
// exactly as they'd see it (staff visibility into the client experience).
async function handlePreview(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'staff') return res.status(403).json({ error: 'staff_only' });
  const { db } = identity;

  const clientId = new URL(req.url, 'http://localhost').searchParams.get('client_id');
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { data: client } = await db
    .from('clients')
    .select('id, name, email, type, company')
    .eq('id', clientId)
    .maybeSingle();
  if (!client) return res.status(404).json({ error: 'client_not_found' });

  const jobs = await buildPortalJobs(db, client.id);
  return res.status(200).json({
    role: 'staff',
    preview: true,
    client: { name: client.name, email: client.email, type: client.type, company: client.company || null },
    jobs,
  });
}

// GET /api/portal/files?job_id=... — list the job's "Files Sent" Drive folder.
// Clients: their own jobs only. Staff: any job (for the portal preview).
async function handleFiles(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'client' && identity.role !== 'staff') return res.status(403).json({ error: 'forbidden' });

  const url = new URL(req.url, 'http://localhost');
  const job = await getJobForIdentity(identity, url.searchParams.get('job_id'));
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  if (!hasDrive()) return res.status(200).json({ configured: false, files: [] });

  // Self-heal: jobs created after the bulk mapper run have a null folder id.
  // Resolve it from Drive on demand and persist on a hit, so the vault populates
  // without anyone re-running scripts/map-drive-folders.js. A miss (no project
  // folder or no "Files Sent" subfolder yet) just reports configured:false.
  let folderId = job.drive_files_sent_folder_id;
  if (!folderId) {
    try {
      folderId = await resolveFilesSentFolderId(job.job_id);
      if (folderId) {
        await identity.db
          .from('jobs')
          .update({ drive_files_sent_folder_id: folderId })
          .eq('job_id', job.job_id);
      }
    } catch (e) {
      console.error('[portal/files] self-heal resolve failed:', e?.message || e);
    }
  }
  if (!folderId) return res.status(200).json({ configured: false, files: [] });

  try {
    const files = await listFolderFiles(folderId);
    res.status(200).json({
      configured: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? Number(f.size) : null,
        modified: f.modifiedTime || null,
      })),
    });
  } catch (e) {
    console.error('[portal/files]', e?.message || e);
    res.status(200).json({ configured: true, files: [], error: 'drive_unavailable' });
  }
}

// GET /api/portal/download?job_id=...&file_id=... — stream a file to the client.
async function handleDownload(req, res, identity) {
  if (identity.role !== 'client' && identity.role !== 'staff') return res.status(403).json({ error: 'forbidden' });

  const url = new URL(req.url, 'http://localhost');
  const fileId = url.searchParams.get('file_id');
  if (!fileId) return res.status(400).json({ error: 'file_id required' });

  const job = await getJobForIdentity(identity, url.searchParams.get('job_id'));
  if (!job || !job.drive_files_sent_folder_id) return res.status(404).json({ error: 'not_found' });
  if (!hasDrive()) return res.status(503).json({ error: 'drive_not_configured' });

  let meta;
  try {
    meta = await getFileMeta(fileId);
  } catch {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!meta?.parents?.includes(job.drive_files_sent_folder_id)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${(meta.name || 'file').replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    await streamFileTo(fileId, res);
  } catch (e) {
    console.error('[portal/download]', e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: 'download_failed' });
  }
}

// One message thread per job. Find-or-create on demand. Clients reach only their
// own job's thread; staff may reach any job's thread (read + reply).
async function findOrCreateThread(db, jobId, create) {
  const { data: existing } = await db.from('threads').select('id').eq('job_id', jobId).maybeSingle();
  if (existing) return existing;
  if (!create) return null;
  const { data, error } = await db.from('threads').insert({ job_id: jobId }).select('id').single();
  if (error) throw new Error(error.message);
  return data;
}

// GET /api/portal/messages?job_id=... — the job's thread messages (oldest first).
async function handleMessages(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'client' && identity.role !== 'staff') return res.status(403).json({ error: 'forbidden' });

  const jobId = req.query?.job_id || new URL(req.url, 'http://localhost').searchParams.get('job_id');
  const job = await getJobForIdentity(identity, jobId, 'job_id');
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  const thread = await findOrCreateThread(identity.db, job.job_id, false);
  let messages = [];
  if (thread) {
    const { data } = await identity.db
      .from('messages')
      .select('id, sender_type, body, via, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });
    messages = data || [];
  }
  return res.status(200).json({ job_id: job.job_id, messages });
}

// POST /api/portal/send { job_id, body } — append a message as client or staff.
async function handleSend(req, res, identity) {
  if (identity.role !== 'client' && identity.role !== 'staff') return res.status(403).json({ error: 'forbidden' });

  const payload = req.body || {};
  const text = String(payload.body || '').trim();
  if (!text) return res.status(400).json({ error: 'empty_message' });
  if (text.length > 5000) return res.status(400).json({ error: 'message_too_long' });

  const job = await getJobForIdentity(identity, payload.job_id, 'job_id');
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  let thread;
  try {
    thread = await findOrCreateThread(identity.db, job.job_id, true);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const senderType = identity.role === 'client' ? 'client' : 'staff';
  const senderId = identity.role === 'client' ? identity.client.id : null;
  const { data: message, error } = await identity.db
    .from('messages')
    .insert({ thread_id: thread.id, sender_type: senderType, sender_id: senderId, body: text, via: 'portal' })
    .select('id, sender_type, body, via, created_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await identity.db.from('threads').update({ updated_at: new Date().toISOString() }).eq('id', thread.id);
  // Email notification to the other party is a later slice (notifications table ready).
  return res.status(200).json({ message });
}

// ---------------------------------------------------------------------------
// Magic-link access (clients authenticate by clicking a link — see portal-session.js)
// ---------------------------------------------------------------------------

// GET /api/portal/enter?t=<token>[&job=<job_id>] — PUBLIC. This IS the login: validate
// the token, exchange it for a signed session cookie, then REDIRECT so the token leaves
// the address bar (a URL with a live credential in it gets pasted, logged, and shared).
// Always redirects — a client should never see a JSON error page.
async function handleEnter(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('t');
  const job = url.searchParams.get('job');

  const fail = (reason) => res.redirect(302, `/?portal_error=${reason}`);

  if (!token || !hasDb()) return fail('invalid');

  const db = getDb();
  const { data: link } = await db
    .from('portal_links')
    .select('id, client_id, expires_at, revoked_at, use_count')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  // Same response for "no such token" and "expired/revoked" — don't help a guesser
  // distinguish them. (The client-facing copy explains how to get a fresh link.)
  if (!isLinkUsable(link)) return fail('expired');

  const { data: client } = await db
    .from('clients')
    .select('id, is_active')
    .eq('id', link.client_id)
    .maybeSingle();
  if (!client || client.is_active === false) return fail('expired');

  // Best-effort audit trail; never block sign-in on it.
  db.from('portal_links')
    .update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 })
    .eq('id', link.id)
    .then(() => {}, (err) => console.error('[portal/enter] touch link', err));

  res.setHeader('Set-Cookie', sessionCookies(signSession(client.id), { secure: isSecureReq(req) }));
  return res.redirect(302, job ? `/?job=${encodeURIComponent(job)}` : '/');
}

// GET /api/portal/signout — clear the portal cookies. Public: it must work even when
// the session is already stale.
async function handleSignout(req, res) {
  res.setHeader('Set-Cookie', clearCookies({ secure: isSecureReq(req) }));
  return res.redirect(302, '/');
}

// POST /api/portal/invite { client_id, days? } — STAFF. Mint a magic link for a client.
// The raw token is returned ONCE (it isn't stored — only its hash), so the caller must
// use it immediately; a lost link is re-minted, not recovered.
async function handleInvite(req, res, staff) {
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const db = getDb();

  const clientId = req.body?.client_id;
  const days = Number(req.body?.days) || DEFAULT_LINK_TTL_DAYS;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { data: client } = await db
    .from('clients')
    .select('id, name, email, is_active')
    .eq('id', clientId)
    .maybeSingle();
  if (!client) return res.status(404).json({ error: 'client_not_found' });
  if (client.is_active === false) return res.status(409).json({ error: 'client_inactive' });

  const token = mintToken();
  const expires_at = linkExpiry(days);
  const { error } = await db.from('portal_links').insert({
    client_id: client.id,
    token_hash: hashToken(token),
    expires_at,
    created_by: String(staff),
  });
  if (error) return res.status(500).json({ error: error.message });

  // PORTAL_BASE_URL lets the link point at portal.rm117.com even though the request
  // arrived on the Vercel host.
  const origin = process.env.PORTAL_BASE_URL || `https://${req.headers.host}`;
  return res.status(200).json({
    client: { id: client.id, name: client.name, email: client.email },
    url: `${origin}/enter?t=${token}`,
    expires_at,
  });
}

// GET /api/portal/links?client_id=... — STAFF. A client's links (never the tokens —
// they're unrecoverable by design; this is for seeing/revoking what's live).
async function handleLinks(req, res) {
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const clientId = new URL(req.url, 'http://localhost').searchParams.get('client_id');
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { data } = await getDb()
    .from('portal_links')
    .select('id, created_at, created_by, expires_at, revoked_at, last_used_at, use_count')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  const now = Date.now();
  return res.status(200).json({
    links: (data || []).map((l) => ({
      ...l,
      active: isLinkUsable(l, now),
    })),
  });
}

// POST /api/portal/revoke { link_id } — STAFF. Kill a link immediately.
async function handleRevoke(req, res) {
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const linkId = req.body?.link_id;
  if (!linkId) return res.status(400).json({ error: 'link_id required' });

  const { error } = await getDb()
    .from('portal_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ revoked: true });
}
