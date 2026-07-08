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

    // 2. Pull QBO payments + the valid job-id set + linked invoices (for type inference).
    const payments = await listPaymentsUpdatedSince(since);

    const { data: jobRows, error: jobErr } = await db.from('jobs').select('job_id');
    if (jobErr) throw jobErr;
    const jobIds = new Set((jobRows || []).map((j) => j.job_id));

    const allInvoiceIds = [];
    for (const p of payments) allInvoiceIds.push(...linkedInvoiceIds(p));
    const invoices = await getInvoicesByIds(allInvoiceIds);
    const invText = new Map(invoices.map((inv) => [String(inv.Id), invoiceTypeText(inv)]));

    // 2b. Preload EVERY existing qb payment row for reconciliation. This is the
    // critical dedup input: besides webhook rows (keyed by qbo_invoice_id), the app
    // holds ~147 rows tagged "Imported from QBO historical export" that have NO QBO
    // ids at all. Keying only on ids would miss them and re-insert duplicates, so we
    // also adopt by (job_id + amount), disambiguating same-amount rows by nearest
    // paid_date and claiming each row at most once per run.
    const { data: qbRows, error: qbErr } = await db
      .from('payments')
      .select('id, job_id, amount, paid_date, qbo_invoice_id, qbo_payment_id, payment_type, payment_type_locked')
      .eq('payment_method', 'qb');
    if (qbErr) throw qbErr;

    const byPaymentId = new Map();       // qbo_payment_id -> row (already-synced)
    const adoptableByJob = new Map();    // job_id -> [rows with no qbo_payment_id]
    for (const r of qbRows) {
      if (r.qbo_payment_id) { byPaymentId.set(String(r.qbo_payment_id), r); continue; }
      if (!adoptableByJob.has(r.job_id)) adoptableByJob.set(r.job_id, []);
      adoptableByJob.get(r.job_id).push(r);
    }
    const claimed = new Set();           // existing row ids already matched this run
    const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000) || 0;

    // 3. Reconcile each payment.
    const summary = {
      dry, full, since,
      scanned: payments.length,
      insert: 0, adopt: 0, unchanged: 0, skipped_zero: 0,
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

      // Already synced to this exact QBO payment → nothing to do (idempotent re-run).
      if (byPaymentId.has(qboPaymentId)) { summary.unchanged += 1; continue; }

      // Adopt an existing unclaimed qb row for the same job + amount. Prefer one whose
      // qbo_invoice_id matches a linked invoice, then the nearest paid_date.
      const cands = (adoptableByJob.get(jobId) || [])
        .filter((r) => !claimed.has(r.id) && Number(r.amount) === amount);
      cands.sort((a, b) => {
        const ai = invIds.includes(String(a.qbo_invoice_id)) ? 0 : 1;
        const bi = invIds.includes(String(b.qbo_invoice_id)) ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return dayDiff(a.paid_date, paidDate) - dayDiff(b.paid_date, paidDate);
      });
      const adoptRow = cands[0] || null;
      const mode = adoptRow ? 'adopt' : 'insert';

      const inferredType = normalizePaymentType(invIds.map((id) => invText.get(id) || '').join(' '));

      if (adoptRow) claimed.add(adoptRow.id);
      summary[mode] += 1;
      if (actions.length < MAX_ACTIONS_RETURNED) {
        actions.push({
          mode, job_id: jobId, amount, paid_date: paidDate, qbo_payment_id: qboPaymentId,
          payment_type: adoptRow ? adoptRow.payment_type : inferredType,
          adopted_row: adoptRow ? adoptRow.id : undefined,
        });
      }

      if (dry) continue; // dry run: decide, don't write

      if (mode === 'adopt') {
        // Additive only: stamp the QBO ids so future runs recognize this row. Never
        // overwrite the imported amount/date/type (that data is at least as trusted).
        const patch = { qbo_payment_id: qboPaymentId };
        if (!adoptRow.qbo_invoice_id && invIds[0]) patch.qbo_invoice_id = invIds[0];
        const { error } = await db.from('payments').update(patch).eq('id', adoptRow.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('payments').insert({
          job_id: jobId,
          amount,
          payment_method: 'qb',
          payment_type: inferredType,
          paid_date: paidDate,
          qbo_invoice_id: invIds[0] || null,
          qbo_payment_id: qboPaymentId,
          notes: `Synced from QuickBooks (payment ${qboPaymentId})`,
        });
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
