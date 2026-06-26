// New job drawer — create a job (Job ID must match the QBO Customer Display Name).
import React, { useState } from 'react';
import { PHASE_ORDER, PHASE_LABELS } from '../../lib/format.js';

export default function NewJobDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    job_id: '',
    client_name: '',
    address: '',
    phase: 'potential',
    job_total: '',
    is_forefront: false,
    ff_commission: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        ...form,
        job_total: Number(form.job_total) || 0,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="New job">
        <div className="drawer-head">
          <div>
            <h2>New Job</h2>
            <div className="sub">Job ID must match the QuickBooks Customer Display Name exactly.</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <label>Job ID — YY_NNN_[FF_]LastName</label>
            <input type="text" value={form.job_id} onChange={set('job_id')} placeholder="26_012_Smith or 26_012_FF_Smith" />
          </div>
          <div className="field">
            <label>Client name</label>
            <input type="text" value={form.client_name} onChange={set('client_name')} />
          </div>
          <div className="field">
            <label>Address</label>
            <input type="text" value={form.address} onChange={set('address')} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Phase</label>
              <select value={form.phase} onChange={set('phase')}>
                {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Job total ($)</label>
              <input type="number" min="0" step="0.01" value={form.job_total} onChange={set('job_total')} />
            </div>
          </div>
          <label className="check-field">
            <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
            Forefront job
          </label>
          {form.is_forefront && (
            <div className="field">
              <label>FF commission ($)</label>
              <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} />
            </div>
          )}
          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <div className="drawer-foot">
          {error && <span className="error">{error}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.job_id || !form.client_name}>
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </div>
    </>
  );
}
