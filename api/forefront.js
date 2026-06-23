// GET /api/forefront — list all Forefront commissions with job details
// POST /api/forefront — log a commission payment for a job
import { getDb, hasDb } from './_lib/db.js';
import { requireStaff } from './_lib/require-staff.js';

const MOCK = [
  { id: 'mock-1', job_id: '26_009_FF_Chou', total_commission: 1200, amount_paid: 0, payment_history: [], status: 'active', notes: null, jobs: { client_name: 'Frank Chou', phase: 'design_phase', address: '622 Prospect Ave, Westfield NJ' } },
  { id: 'mock-2', job_id: '25_038_FF_Basho', total_commission: 1200, amount_paid: 600, payment_history: [{ amount: 600, date: '2025-10-01', method: 'check', notes: '' }], status: 'active', notes: null, jobs: { client_name: 'Ardit & Sonia Basho', phase: 'active', address: '204 Robinhood Rd, Mountainside' } },
];

export default async function handler(req, res) {
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (req.method === 'GET') {
    if (!hasDb()) return res.json({ source: 'mock', commissions: MOCK });
    const db = getDb();
    const { data, error } = await db
      .from('forefront_commissions')
      .select('*, jobs(client_name, phase, phase_override, address, job_total)')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ source: 'supabase', commissions: data || [] });
  }

  if (req.method === 'POST') {
    const { job_id, amount, date, method, notes } = req.body || {};
    if (!job_id || !amount || !date || !method) {
      return res.status(400).json({ error: 'job_id, amount, date, method are required' });
    }
    if (!hasDb()) {
      return res.json({ source: 'mock', persisted: false, message: 'Mock mode — payment not saved' });
    }
    const db = getDb();

    // Fetch current record
    const { data: current, error: fetchErr } = await db
      .from('forefront_commissions')
      .select('amount_paid, payment_history, total_commission')
      .eq('job_id', job_id)
      .single();
    if (fetchErr) return res.status(404).json({ error: 'Commission record not found' });

    const newEntry = { amount: Number(amount), date, method, notes: notes || '' };
    const newPaid = Number(current.amount_paid || 0) + Number(amount);
    const history = Array.isArray(current.payment_history) ? current.payment_history : [];
    const isComplete = newPaid >= Number(current.total_commission) && Number(current.total_commission) > 0;

    const { error: updateErr } = await db
      .from('forefront_commissions')
      .update({
        amount_paid: newPaid,
        payment_history: [...history, newEntry],
        status: isComplete ? 'completed' : 'active',
      })
      .eq('job_id', job_id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.json({ source: 'supabase', persisted: true, amount_paid: newPaid });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
