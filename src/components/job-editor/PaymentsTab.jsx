// Payments tab (Phase 4) — per-job payment history + manual logging of payments
// received outside QuickBooks. 'qb' is reserved for the Zapier→Supabase sync.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money, shortDate } from '../../lib/format.js';

// 'qb' is reserved for the Zapier→Supabase sync; QuickBooks payments arrive
// automatically, so the manual form only offers payments received outside QBO.
const MANUAL_METHODS = ['check', 'venmo', 'zelle', 'cash', 'other'];
const PAY_TYPES = ['retainer', 'dp1', 'dp2', 'dp3', 'cd', 'final', 'other'];

// A payment came from QuickBooks if it carries a QBO invoice id or the qb method.
const isQboPayment = (p) => p.payment_method === 'qb' || Boolean(p.qbo_invoice_id);

export default function PaymentsTab({ job, onLogged }) {
  const [payments, setPayments] = useState(null);
  const [form, setForm] = useState({
    amount: '',
    payment_method: 'check',
    payment_type: 'other',
    paid_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function loadPayments() {
    const res = await apiFetch(`/api/payments?job_id=${encodeURIComponent(job.job_id)}`);
    const data = await res.json();
    setPayments(data.payments || []);
  }
  useEffect(() => { loadPayments(); }, [job.job_id]);

  const paid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);

  async function logPayment() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, ...form, amount: Number(form.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setForm((f) => ({ ...f, amount: '', notes: '' }));
      await loadPayments();
      onLogged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-body">
        {payments === null ? (
          <div className="placeholder-note">Loading payments…</div>
        ) : payments.length === 0 ? (
          <div className="placeholder-note">No payments logged for this job yet.</div>
        ) : (
          <>
            <ul className="pay-list">
              {payments.map((p) => (
                <li key={p.id}>
                  <span>
                    <span className="amt">{money(p.amount, { cents: true })}</span>{' '}
                    <span className={`pay-src ${isQboPayment(p) ? 'qbo' : 'ext'}`}>
                      {isQboPayment(p) ? 'QuickBooks' : p.payment_method}
                    </span>
                    <span className="meta"> {p.payment_type.toUpperCase()}</span>
                    {p.qbo_invoice_id && <span className="meta"> · INV {p.qbo_invoice_id}</span>}
                    {p.notes && <div className="meta" style={{ textTransform: 'none', letterSpacing: 0 }}>{p.notes}</div>}
                  </span>
                  <span className="when">{shortDate(p.paid_date)}</span>
                </li>
              ))}
            </ul>
            <div className="pay-total">
              <span>Paid {money(paid, { cents: true })} of {money(job.job_total, { cents: true })}</span>
              <span className={Number(job.job_total) - paid > 0 ? 'left' : 'outstanding-zero'}>
                {money(Number(job.job_total) - paid, { cents: true })} left
              </span>
            </div>
          </>
        )}

        <div className="pay-form-title">Log a payment</div>
        <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
          QuickBooks payments sync automatically — log only payments received outside QuickBooks
          (check, Venmo, Zelle, cash).
        </div>
        <div className="field-row">
          <div className="field">
            <label>Amount ($)</label>
            <input type="number" min="0" step="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.paid_date}
              onChange={(e) => setForm((f) => ({ ...f, paid_date: e.target.value }))} />
          </div>
        </div>
        <div className="field">
          <label>Type</label>
          <div className="chip-row">
            {PAY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${form.payment_type === t ? ' active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, payment_type: t }))}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Method</label>
          <div className="chip-row">
            {MANUAL_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${form.payment_method === m ? ' active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, payment_method: m }))}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div className="drawer-foot">
        {error && <span className="error">{error}</span>}
        <button className="btn btn-primary" onClick={logPayment} disabled={saving || !form.amount}>
          {saving
            ? 'Logging…'
            : `Log ${form.amount ? money(Number(form.amount)) + ' ' : ''}payment`}
        </button>
      </div>
    </>
  );
}
