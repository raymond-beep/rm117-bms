// POST /api/payments/webhook
// Called by Zapier when a QuickBooks Online invoice is paid.
// Zapier maps QBO invoice fields to this JSON body and POSTs here.
//
// Expected body from Zapier:
// {
//   "secret":      "{{WEBHOOK_SECRET env var value}}",
//   "job_id":      "{{Customer Display Name from QBO}}",   ← must match YY_NNN_[FF_]LastName
//   "amount":      "{{Total Amount}}",
//   "paid_date":   "{{Transaction Date}}",                 ← YYYY-MM-DD
//   "qbo_invoice_id": "{{Invoice ID}}",
//   "payment_type": "other"                               ← Zapier sends this as a fixed string
// }
import { getDb, hasDb } from '../_lib/db.js';

function normalizePaymentType(raw = '') {
  const t = String(raw).toLowerCase().replace(/[\s-_]+/g, '');
  if (t.includes('retainer') || t.includes('deposit') && t.includes('1') === false) return 'retainer';
  if (t.includes('dp1') || t.includes('deposit1') || t.includes('firstpay')) return 'dp1';
  if (t.includes('dp2') || t.includes('deposit2') || t.includes('secondpay')) return 'dp2';
  if (t.includes('dp3') || t.includes('deposit3')) return 'dp3';
  if (t.includes('cd') || t.includes('construction') || t.includes('permit')) return 'cd';
  if (t.includes('final') || t.includes('balance') || t.includes('last')) return 'final';
  return 'other';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const {
    secret,
    job_id,
    amount,
    paid_date,
    qbo_invoice_id,
    payment_type = 'other',
    notes,
  } = req.body || {};

  // Validate shared secret — must match WEBHOOK_SECRET env var
  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Required fields
  if (!job_id)   return res.status(400).json({ error: 'job_id is required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  if (!paid_date) return res.status(400).json({ error: 'paid_date is required' });

  if (!hasDb()) {
    console.log('[webhook] mock mode — payment not persisted', { job_id, amount });
    return res.status(200).json({ received: true, persisted: false, note: 'mock mode' });
  }

  const db = getDb();

  // Verify the job exists
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('job_id')
    .eq('job_id', job_id)
    .single();

  if (jobErr || !job) {
    // Log but don't hard-fail — QBO customer names sometimes differ slightly
    console.warn('[webhook] job not found for job_id:', job_id);
    return res.status(404).json({ error: `No job found with job_id "${job_id}". Check the QBO Customer Display Name matches exactly.` });
  }

  // Idempotency / dedup: if this QBO invoice already produced a payment, don't
  // insert again. Zapier can retry or double-fire, and we never want a single
  // QBO payment counted twice. Keyed on qbo_invoice_id (the QBO record of truth).
  if (qbo_invoice_id) {
    const { data: existing } = await db
      .from('payments')
      .select('id')
      .eq('qbo_invoice_id', qbo_invoice_id)
      .maybeSingle();
    if (existing) {
      console.log('[webhook] duplicate ignored for qbo_invoice_id', qbo_invoice_id);
      return res.status(200).json({ received: true, persisted: false, duplicate: true, payment_id: existing.id });
    }
  }

  // Insert the payment record
  const row = {
    job_id,
    amount: Number(amount),
    payment_method: 'qb',
    payment_type: normalizePaymentType(payment_type),
    paid_date,
    qbo_invoice_id: qbo_invoice_id || null,
    notes: notes || 'Auto-synced from QuickBooks via Zapier',
  };

  const { data, error } = await db.from('payments').insert(row).select().single();
  if (error) {
    console.error('[webhook] insert failed:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log('[webhook] payment logged:', data.id, 'for job', job_id, 'amount', amount);
  return res.status(201).json({ received: true, persisted: true, payment_id: data.id });
}
