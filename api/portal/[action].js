// Single serverless function for ALL client-portal routes, dispatched by the
// trailing path segment: /api/portal/me | /files | /download (and future
// /messages, /send, …). Consolidated into one function to stay within the
// Vercel Hobby 12-function limit and to keep portal surface area in one place.
//
// Every action goes through resolvePortalIdentity first, so client isolation is
// enforced uniformly. The portal is deliberately money-free.
import { resolvePortalIdentity, getClientJob } from '../_lib/portal-auth.js';
import { hasDrive, listFolderFiles, getFileMeta, streamFileTo } from '../_lib/google-drive.js';

function group(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

export default async function handler(req, res) {
  // On Vercel the dynamic segment arrives as req.query.action; locally we derive
  // it from the URL so the same file serves both.
  const action = req.query?.action || new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).pop();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const identity = await resolvePortalIdentity(req);
  if (identity.unauthorized) return res.status(401).json({ error: 'unauthorized' });

  switch (action) {
    case 'me':
      return handleMe(req, res, identity);
    case 'files':
      return handleFiles(req, res, identity);
    case 'download':
      return handleDownload(req, res, identity);
    default:
      return res.status(404).json({ error: 'unknown_action' });
  }
}

// GET /api/portal/me — the authenticated client's own jobs (status only, no money).
async function handleMe(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'client') return res.status(200).json({ role: identity.role });
  const { client, db } = identity;

  const { data: jobs = [], error: jobsErr } = await db
    .from('jobs')
    .select('job_id, client_name, address, phase, phase_override, next_milestone_label, next_milestone_date, created_at, updated_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });
  if (jobsErr) return res.status(500).json({ error: jobsErr.message });

  const jobIds = jobs.map((j) => j.job_id);
  const { data: events = [] } = jobIds.length
    ? await db.from('job_phase_events').select('job_id, phase, entered_at').in('job_id', jobIds).order('entered_at', { ascending: true })
    : { data: [] };
  const evByJob = group(events, 'job_id');

  const portalJobs = jobs.map((j) => {
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

  return res.status(200).json({
    role: 'client',
    client: { name: client.name, email: client.email, type: client.type, company: client.company || null },
    jobs: portalJobs,
  });
}

// GET /api/portal/files?job_id=... — list the job's "Files Sent" Drive folder.
async function handleFiles(req, res, identity) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (identity.role !== 'client') return res.status(403).json({ error: 'forbidden' });
  const { client, db } = identity;

  const url = new URL(req.url, 'http://localhost');
  const job = await getClientJob(db, client.id, url.searchParams.get('job_id'));
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
  if (identity.role !== 'client') return res.status(403).json({ error: 'forbidden' });
  const { client, db } = identity;

  const url = new URL(req.url, 'http://localhost');
  const fileId = url.searchParams.get('file_id');
  if (!fileId) return res.status(400).json({ error: 'file_id required' });

  const job = await getClientJob(db, client.id, url.searchParams.get('job_id'));
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
