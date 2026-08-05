// GET /api/clients/directory — every client with their jobs and their contacts, plus the
// jobs that are not attached to any client at all.
//
// Why a separate endpoint rather than a flag on /api/clients: that route is shared with the
// JobEditor's Details picker and the portal, both of which want a plain list. This one is
// shaped for a screen, joins two more tables, and is free to change without touching them.
//
// Read-only. Editing goes through the existing POST /api/clients, so there is exactly one
// place a client record is written.
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';

const CLIENT_FIELDS = 'id, name, type, email, phone, company, is_active';
const JOB_FIELDS = 'job_id, client_id, client_name, address, phase, phase_override, job_total, is_forefront, is_fire_escape';
const CONTACT_FIELDS = 'id, client_id, name, email, role, is_primary, is_active';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return undefined;

  if (!hasDb()) return res.status(200).json({ source: 'mock', clients: [], unlinkedJobs: [] });

  try {
    const db = getDb();
    const [cRes, jRes, ctRes] = await Promise.all([
      db.from('clients').select(CLIENT_FIELDS).order('name', { ascending: true }),
      db.from('jobs').select(JOB_FIELDS),
      db.from('client_contacts').select(CONTACT_FIELDS),
    ]);
    // Fail loudly. A directory whose whole job is showing what is missing must never render
    // a half-loaded page — "no jobs" and "couldn't load jobs" look identical on screen and
    // mean opposite things.
    for (const r of [cRes, jRes, ctRes]) if (r.error) throw r.error;

    const jobs = jRes.data || [];
    const contacts = ctRes.data || [];

    const jobsByClient = new Map();
    for (const j of jobs) {
      if (!j.client_id) continue;
      if (!jobsByClient.has(j.client_id)) jobsByClient.set(j.client_id, []);
      jobsByClient.get(j.client_id).push(j);
    }

    const contactsByClient = new Map();
    for (const c of contacts) {
      if (!c.is_active) continue; // deactivated contacts are kept for history, not shown here
      if (!contactsByClient.has(c.client_id)) contactsByClient.set(c.client_id, []);
      contactsByClient.get(c.client_id).push(c);
    }

    const clients = (cRes.data || []).map((c) => ({
      ...c,
      jobs: (jobsByClient.get(c.id) || []).sort((a, b) => (a.job_id || '').localeCompare(b.job_id || '')),
      contacts: (contactsByClient.get(c.id) || []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    }));

    // The jobs with no client at all. Mostly Drive imports, which land with client_id NULL
    // on purpose (a wrong client link is worse than none — see the Drive sync invariant).
    // Nothing in the app surfaced them until now, so they were invisible rather than fixed.
    const unlinkedJobs = jobs
      .filter((j) => !j.client_id)
      .sort((a, b) => (a.job_id || '').localeCompare(b.job_id || ''));

    return res.status(200).json({ source: 'supabase', clients, unlinkedJobs });
  } catch (err) {
    console.error('[api/clients/directory]', err);
    return res.status(500).json({ error: err.message });
  }
}
