// GET /api/jobs — all jobs with computed outstanding (Phase 3).
// Reads from Supabase when configured; falls back to mock data pre-Phase-1.
// outstanding = job_total - sum(payments.amount) — computed here, never stored.
import { getDb, hasDb, computeOutstanding } from './_lib/db.js';
import { MOCK_JOBS, MOCK_PAYMENTS } from './_lib/mock-data.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let jobs, payments;

    if (hasDb()) {
      const db = getDb();
      const [jobsRes, paymentsRes] = await Promise.all([
        db.from('jobs').select('*').order('created_at', { ascending: false }),
        db.from('payments').select('job_id, amount'),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      jobs = jobsRes.data;
      payments = paymentsRes.data;
    } else {
      jobs = MOCK_JOBS;
      payments = MOCK_PAYMENTS;
    }

    const paymentsByJob = new Map();
    for (const p of payments) {
      if (!paymentsByJob.has(p.job_id)) paymentsByJob.set(p.job_id, []);
      paymentsByJob.get(p.job_id).push(p);
    }

    const enriched = jobs.map((job) => ({
      ...job,
      outstanding: computeOutstanding(job, paymentsByJob.get(job.job_id)),
    }));

    res.status(200).json({ source: hasDb() ? 'supabase' : 'mock', jobs: enriched });
  } catch (err) {
    console.error('[api/jobs]', err);
    res.status(500).json({ error: err.message });
  }
}
