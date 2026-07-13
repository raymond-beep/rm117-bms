// POST /api/qbo/create-invoice — create (and optionally email) a QBO invoice for a job.
// Body: {
//   job_id,                     // required — YY_NNN_[FF_]LastName
//   lines: [{ item_id? | item_name?, amount, description?, qty? }],  // required, >=1
//   due_date?,                  // 'YYYY-MM-DD'
//   memo?,                      // private note on the QBO invoice
//   send?: boolean,             // true → email it to the client after creating
// }
//
// Flow: ensure the QBO customer exists (DisplayName === Job ID), create the
// invoice against it, optionally email it, then mirror it into our `invoices`
// table with the returned qbo_invoice_id. That id is the idempotency key the
// inbound Zapier payment webhook matches on, so the loop closes cleanly.
//
// Line items bill against QBO service items (by id or name). Known ids on the real
// company: 4 Final Design · 5 Architectural CDs · 7 Final CDs · 13 Project Retainer.
import { getDb, hasDb, JOB_ID_RE, isPlaceholderJobId } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, findOrCreateCustomer, createInvoice, sendInvoice } from '../_lib/qbo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasQbo()) {
    return res.status(503).json({ error: 'QBO not configured (missing QBO_* env vars)' });
  }

  const { job_id, lines, due_date, memo, send = false } = req.body || {};
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
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'lines must be a non-empty array' });
  }
  for (const l of lines) {
    if (l == null || l.amount == null || Number(l.amount) <= 0) {
      return res.status(400).json({ error: 'each line needs an amount > 0' });
    }
    if (!l.item_id && !l.item_name) {
      return res.status(400).json({ error: 'each line needs item_id or item_name' });
    }
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

    // 1) Ensure the QBO customer exists (DisplayName === Job ID).
    const { customer } = await findOrCreateCustomer({
      displayName: job.job_id,
      email: client.email || undefined,
      phone: client.phone || undefined,
      company: client.company || undefined,
    });
    if (!customer?.Id) throw new Error('Could not resolve a QBO customer for this job');

    // 2) Create the invoice.
    const invoice = await createInvoice({
      customerId: customer.Id,
      email: client.email || undefined,
      dueDate: due_date || undefined,
      memo: memo || undefined,
      lines: lines.map((l) => ({
        itemId: l.item_id,
        itemName: l.item_name,
        amount: Number(l.amount),
        description: l.description,
        qty: l.qty,
      })),
    });
    if (!invoice?.Id) throw new Error('QBO did not return a created invoice');

    // 3) Optionally email it now.
    let sent = false;
    if (send) {
      try {
        await sendInvoice(invoice.Id, client.email || undefined);
        sent = true;
      } catch (sendErr) {
        // The invoice exists in QBO — don't fail the whole call if only the email did.
        console.warn('[api/qbo/create-invoice] send failed:', sendErr.message);
      }
    }

    // 4) Mirror into our invoices table (best-effort; QBO is the record of truth).
    const lineItems = (invoice.Line || [])
      .filter((ln) => ln.DetailType === 'SalesItemLineDetail')
      .map((ln) => ({
        description: ln.Description || '',
        qty: ln.SalesItemLineDetail?.Qty ?? 1,
        rate: ln.SalesItemLineDetail?.UnitPrice ?? Number(ln.Amount),
        amount: Number(ln.Amount),
      }));
    let invoiceRowId = null;
    try {
      const { data: row, error: insErr } = await db
        .from('invoices')
        .insert({
          job_id,
          line_items: lineItems,
          total: Number(invoice.TotalAmt ?? lines.reduce((s, l) => s + Number(l.amount), 0)),
          status: sent ? 'sent' : 'draft',
          qbo_invoice_id: String(invoice.Id),
          sent_date: sent ? new Date().toISOString() : null,
          due_date: due_date || null,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      invoiceRowId = row?.id || null;
    } catch (mirrorErr) {
      console.warn('[api/qbo/create-invoice] local mirror insert failed:', mirrorErr.message);
    }

    return res.status(201).json({
      qbo_invoice_id: String(invoice.Id),
      doc_number: invoice.DocNumber || null,
      total: Number(invoice.TotalAmt ?? 0),
      sent,
      invoice_row_id: invoiceRowId,
      customer: { id: customer.Id, displayName: customer.DisplayName },
    });
  } catch (err) {
    console.error('[api/qbo/create-invoice]', err);
    return res.status(502).json({ error: err.message });
  }
}
