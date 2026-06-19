// Single serverless function for ALL client-portal routes, dispatched by the
// trailing path segment: /api/portal/me | /files | /download (and future
// /messages, /send, …). Consolidated into one function to stay within the
// Vercel Hobby 12-function limit and to keep portal surface area in one place.
//
// Every action goes through resolvePortalIdentity first, so client isolation is
// enforced uniformly. The portal is deliberately money-free.
import { resolvePortalIdentity, getJobForIdentity } from '../_lib/portal-auth.js';
import { hasDrive, listFolderFiles, getFileMeta, streamFileTo } from '../_lib/google-drive.js';

function group(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

// Allowed HTTP method per action (everything is GET except posting a message).
const METHODS = { me: 'GET', preview: 'GET', files: 'GET', download: 'GET', messages: 'GET', send: 'POST' };

export default async function handler(req, res) {
  // On Vercel the dynamic segment arrives as req.query.action; locally we derive
  // it from the URL so the same file serves both.
  const action = req.query?.action || new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).pop();

  const allowed = METHODS[action];
  if (!allowed) return res.status(404).json({ error: 'unknown_action' });
  if (req.method !== allowed) return res.status(405).json({ error: 'Method not allowed' });

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

// Build the portal payload (status only, no money) for one client id.
async function buildPortalJobs(db, clientId) {
  const { data: jobs = [], error } = await db
    .from('jobs')
    .select('job_id, client_name, address, phase, phase_override, next_milestone_label, next_milestone_date, created_at, updated_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const jobIds = jobs.map((j) => j.job_id);
  const { data: events = [] } = jobIds.length
    ? await db.from('job_phase_events').select('job_id, phase, entered_at').in('job_id', jobIds).order('entered_at', { ascending: true })
    : { data: [] };
  const evByJob = group(events, 'job_id');

  return jobs.map((j) => {
    const timeline = (evByJob.get(j.job_id) || []).map((e) => ({ phase: e.phase, at: e.entered_at }));
    const lastEventAt = timeline.length ? timeline[timeline.length - 1].at : null;
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

  if (!job.drive_files_sent_folder_id || !hasDrive()) {
    return res.status(200).json({ configured: false, files: [] });
  }
  try {
    const files = await listFolderFiles(job.drive_files_sent_folder_id);
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
