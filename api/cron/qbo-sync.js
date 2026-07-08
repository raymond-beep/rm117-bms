// GET /api/cron/qbo-sync — scheduled QuickBooks → app payment reconciliation.
//
// Pulls QBO Payment objects and reconciles them into the `payments` table so every
// job stays in step with QuickBooks — the completeness backstop to the event-driven
// Zapier webhook (which silently drops a payment when the Job ID doesn't match the
// QBO customer name at post time). See QBO_SYNC_PLAN.md.
//
// SAFETY: only ever touches rows with payment_method='qb'. Manual cash/check/etc.
// entries are never read, updated, or deleted. QuickBooks is truth for QBO payments
// only — never a blanket overwrite.
//
// Query params:
//   ?dry=0   actually write (default is DRY — reports what it *would* do, no writes,
//            watermark not advanced). The cron will call it with ?dry=0 once enabled.
//   ?full=1  ignore the stored watermark and sweep all history (first run / manual
//            full reconcile).
//
// Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or a staff session
// (for manual dry-runs from the browser / local dev).
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, listPaymentsUpdatedSince, getInvoicesByIds } from '../_lib/qbo.js';
import { normalizePaymentType } from '../_lib/payment-type.js';

const SYNC_ID = 'qbo_payments';
const MAX_ACTIONS_RETURNED = 100; // cap the per-row detail in the response

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; accept that, else require staff.
async function authorize(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization || '';
  if (secret && auth === `Bearer ${secret}`) return true;
  return Boolean(await requireStaff(req, res)); // sends 401/403 on failure
}

// The QBO invoice ids a payment applied to (LinkedTxn TxnType 'Invoice').
function linkedInvoiceIds(payment) {
  const ids = [];
  for (const ln of payment.Line || []) {
    for (const lt of ln.LinkedTxn || []) {
      if (lt.TxnType === 'Invoice' && lt.TxnId) ids.push(String(lt.TxnId));
    }
  }
  return ids;
}

// Text used to infer payment_type from an invoice (item names + line descriptions + memos).
function invoiceTypeText(inv) {
  const parts = [inv.PrivateMemo, inv.CustomerMemo?.value];
  for (const ln of inv.Line || []) {
    parts.push(ln.Description);
    parts.push(ln.SalesItemLineDetail?.ItemRef?.name);
  }
  return parts.filter(Boolean).join(' ');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorize(req, res))) return;

  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' });
  if (!hasQbo()) return res.status(503).json({ error: 'QuickBooks not configured' });

  const url = new URL(req.url, 'http://localhost');
  const dry = url.searchParams.get('dry') !== '0'; // dry unless explicitly ?dry=0
  const full = url.searchParams.get('full') === '1';

  const db = getDb();

  try {
    // 1. Watermark (incremental) unless a full sweep is requested.
    let since = null;
    if (!full) {
      const { data: state } = await db
        .from('sync_state').select('watermark').eq('id', SYNC_ID).maybeSingle();
      since = state?.watermark || null;
    }

    // 2. Pull payments + the valid job-id set + linked invoices (for type inference).
    const payments = await listPaymentsUpdatedSince(since);

    const { data: jobRows, error: jobErr } = await db.from('jobs').select('job_id');
    if (jobErr) throw jobErr;
    const jobIds = new Set((jobRows || []).map((j) => j.job_id));

    const allInvoiceIds = [];
    for (const p of payments) allInvoiceIds.push(...linkedInvoiceIds(p));
    const invoices = await getInvoicesByIds(allInvoiceIds);
    const invText = new Map(invoices.map((inv) => [String(inv.Id), invoiceTypeText(inv)]));

    // 3. Reconcile each payment.
    const summary = {
      dry, full, since,
      scanned: payments.length,
      insert: 0, adopt: 0, update: 0, unchanged: 0, skipped_zero: 0,
      unmatched: [],
    };
    const actions = [];
    let maxUpdated = since;

    for (const p of payments) {
      const lastUpdated = p.MetaData?.LastUpdatedTime || null;
      if (lastUpdated && (!maxUpdated || lastUpdated > maxUpdated)) maxUpdated = lastUpdated;

      const jobId = p.CustomerRef?.name;
      const amount = Number(p.TotalAmt || 0);
      const paidDate = String(p.TxnDate || '').slice(0, 10);
      const qboPaymentId = String(p.Id);
      const invIds = linkedInvoiceIds(p);

      if (!jobId || !jobIds.has(jobId)) {
        summary.unmatched.push({ qbo_payment_id: qboPaymentId, customer: jobId || null, amount, paid_date: paidDate });
        continue;
      }
      if (amount <= 0) { summary.skipped_zero += 1; continue; } // unapplied/zero payment

      // Find existing: first by payment id, else an adoptable legacy qb row.
      const { data: byPay } = await db
        .from('payments').select('*').eq('qbo_payment_id', qboPaymentId).maybeSingle();

      let existing = byPay;
      let mode;
      if (existing) {
        mode = 'update';
      } else if (invIds.length) {
        const { data: cand } = await db
          .from('payments').select('*')
          .in('qbo_invoice_id', invIds)
          .is('qbo_payment_id', null)
          .eq('payment_method', 'qb');
        existing = (cand || [])[0] || null;
        mode = existing ? 'adopt' : 'insert';
      } else {
        mode = 'insert';
      }

      const inferredType = normalizePaymentType(invIds.map((id) => invText.get(id) || '').join(' '));
      const paymentType = existing?.payment_type_locked ? existing.payment_type : inferredType;

      const desired = {
        job_id: jobId,
        amount,
        payment_method: 'qb',
        payment_type: paymentType,
        paid_date: paidDate,
        qbo_invoice_id: invIds[0] || existing?.qbo_invoice_id || null,
        qbo_payment_id: qboPaymentId,
      };

      // On update, detect a genuine no-op so the summary is honest.
      if (mode === 'update') {
        const same =
          existing.job_id === desired.job_id &&
          Number(existing.amount) === desired.amount &&
          existing.payment_type === desired.payment_type &&
          String(existing.paid_date) === desired.paid_date &&
          existing.qbo_invoice_id === desired.qbo_invoice_id;
        if (same) { summary.unchanged += 1; continue; }
      }

      summary[mode] += 1;
      if (actions.length < MAX_ACTIONS_RETURNED) {
        actions.push({ mode, job_id: jobId, amount, paid_date: paidDate, payment_type: paymentType, qbo_payment_id: qboPaymentId });
      }

      if (dry) continue; // dry run: decide, don't write

      if (mode === 'insert') {
        const { error } = await db.from('payments').insert({
          ...desired,
          notes: `Synced from QuickBooks (payment ${qboPaymentId})`,
        });
        if (error) throw error;
      } else {
        // update or adopt — both write the reconciled fields onto the existing row
        const { error } = await db.from('payments').update(desired).eq('id', existing.id);
        if (error) throw error;
      }
    }

    // 4. Persist watermark + summary (live runs only).
    if (!dry) {
      const { error } = await db.from('sync_state').upsert({
        id: SYNC_ID,
        watermark: maxUpdated,
        last_run_at: new Date().toISOString(),
        last_summary: summary,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }

    console.log('[cron/qbo-sync]', JSON.stringify(summary));
    return res.status(200).json({ ok: true, summary, actions });
  } catch (err) {
    console.error('[cron/qbo-sync]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
