// /api/payments — payment records per job (Phase 4).
// GET  ?job_id=...  → payment history for a job (or all payments if omitted)
// POST { job_id, amount, payment_method, payment_type, paid_date, notes? }
import { getDb, hasDb } from './_lib/db.js';
import { MOCK_PAYMENTS } from './_lib/mock-data.js';

const METHODS = ['check', 'venmo', 'zelle', 'qb', 'cash', 'other'];
const TYPES = ['retainer', 'dp1', 'dp2', 'dp3', 'cd', 'final', 'other'];

export default async function handler(req, res) {
  if (req.method === 'GET') return getPayments(req, res);
  if (req.method === 'POST') return createPayment(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getPayments(req, res) {
  const jobId = req.query.job_id;
  try {
    if (!hasDb()) {
      const rows = jobId ? MOCK_PAYMENTS.filter((p) => p.job_id === jobId) : MOCK_PAYMENTS;
      return res.status(200).json({ source: 'mock', payments: rows });
    }
    const db = getDb();
    let q = db.from('payments').select('*').order('paid_date', { ascending: false });
    if (jobId) q = q.eq('job_id', jobId);
    const { data, error } = await q;
    if (error) throw error;
    res.status(200).json({ source: 'supabase', payments: data });
  } catch (err) {
    console.error('[api/payments GET]', err);
    res.status(500).json({ error: err.message });
  }
}

async function createPayment(req, res) {
  const { job_id, amount, payment_method, payment_type, paid_date, notes } = req.body || {};

  if (!job_id) return res.status(400).json({ error: 'job_id is required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  if (!METHODS.includes(payment_method)) {
    return res.status(400).json({ error: `payment_method must be one of: ${METHODS.join(', ')}` });
  }
  if (!TYPES.includes(payment_type)) {
    return res.status(400).json({ error: `payment_type must be one of: ${TYPES.join(', ')}` });
  }
  if (!paid_date) return res.status(400).json({ error: 'paid_date is required' });

  const row = { job_id, amount: Number(amount), payment_method, payment_type, paid_date, notes: notes || null };

  if (!hasDb()) {
    return res.status(200).json({ source: 'mock', persisted: false, payment: { id: `mock-${Date.now()}`, ...row } });
  }

  try {
    const db = getDb();
    const { data, error } = await db.from('payments').insert(row).select().single();
    if (error) throw error;
    res.status(201).json({ source: 'supabase', persisted: true, payment: data });
  } catch (err) {
    console.error('[api/payments POST]', err);
    res.status(500).json({ error: err.message });
  }
}
