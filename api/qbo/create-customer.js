// POST /api/qbo/create-customer — ensure a job's customer exists in QBO.
// Body: { job_id }
//
// The QBO Customer DisplayName === the Job ID (the invariant the inbound Zapier
// webhook also relies on). We read the job + its linked client from Supabase to
// fill name/email/phone/company, then find-or-create the matching QBO customer.
// Idempotent: if the customer already exists it's returned untouched.
import { getDb, hasDb, JOB_ID_RE, isPlaceholderJobId } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, findOrCreateCustomer } from '../_lib/qbo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasQbo()) {
    return res.status(503).json({ error: 'QBO not configured (missing QBO_* env vars)' });
  }

  const { job_id } = req.body || {};
  if (!job_id || !JOB_ID_RE.test(job_id)) {
    return res.status(400).json({ error: 'A valid job_id (YY_NNN_[FF_]LastName) is required' });
  }
  // A LEAD (`26_xxx_Smith`) has no official number yet, and the Job ID IS the QuickBooks
  // Customer Display Name — the invariant the whole sync rests on. Never let a placeholder
  // into QBO; it would have to be renamed the moment the proposal is signed.
  if (isPlaceholderJobId(job_id)) {
    return res.status(409).json({
      error: 'This job is still a lead (no official Job ID). Move it past Proposal Sent to assign its number first.',
    });
  }
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' });

  try {
    const db = getDb();
    const { data: job, error } = await db
      .from('jobs')
      .select('job_id, client_id, client_name')
      .eq('job_id', job_id)
      .single();
    if (error || !job) return res.status(404).json({ error: `No job "${job_id}"` });

    // Pull the linked client separately (mirrors api/jobs.js — no embedded join).
    let client = {};
    if (job.client_id) {
      const { data: c } = await db
        .from('clients')
        .select('name, email, phone, company')
        .eq('id', job.client_id)
        .maybeSingle();
      if (c) client = c;
    }
    // Best-effort split of a display name into given/family for QBO's name fields.
    const fullName = client.name || job.client_name || '';
    const parts = fullName.trim().split(/\s+/);
    const familyName = parts.length > 1 ? parts[parts.length - 1] : undefined;
    const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || undefined);

    const { customer, created } = await findOrCreateCustomer({
      displayName: job.job_id, // === Job ID, the invariant
      email: client.email || undefined,
      phone: client.phone || undefined,
      company: client.company || undefined,
      givenName,
      familyName,
    });

    return res.status(created ? 201 : 200).json({
      created,
      customer: { id: customer?.Id, displayName: customer?.DisplayName },
    });
  } catch (err) {
    console.error('[api/qbo/create-customer]', err);
    return res.status(502).json({ error: err.message });
  }
}
