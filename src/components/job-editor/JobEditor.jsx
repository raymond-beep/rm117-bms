// JobEditor drawer — Details / Progress / Payments / Messages tabs for one job.
// Details edits save optimistically through the parent's onSave (rollback there).
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money, shortDate, PHASE_ORDER, PHASE_LABELS } from '../../lib/format.js';
import ProgressTab from './ProgressTab.jsx';
import PaymentsTab from './PaymentsTab.jsx';
import MessagesTab from './MessagesTab.jsx';

// Field tags: which fields the client sees in the portal vs internal-only.
const PortalTag = () => <span className="tag-portal" title="Visible to the client in the portal">👁 client</span>;
const InternalTag = () => <span className="tag-internal" title="Internal only — never shown to clients">🔒 internal</span>;

export default function JobEditor({ job, onClose, onSave, onPaymentLogged }) {
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(() => ({
    client_id: job.client_id || '',
    client_name: job.client_name || '',
    address: job.address || '',
    phase: job.phase,
    phase_override: job.phase_override || '',
    job_total: job.job_total ?? 0,
    bill_flag: Boolean(job.bill_flag),
    is_forefront: Boolean(job.is_forefront),
    ff_commission: job.ff_commission ?? '',
    notes: job.notes || '',
    last_correspondence: job.last_correspondence || '',
  }));
  const [clients, setClients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load the client list for the picker — one identity shared with the portal.
  useEffect(() => {
    let live = true;
    apiFetch('/api/clients')
      .then((r) => r.json())
      .then((d) => { if (live) setClients(d.clients || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const linkedClient = clients.find((c) => c.id === form.client_id) || null;

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(job.job_id, {
        ...form,
        client_id: form.client_id || null,
        phase_override: form.phase_override || null,
        job_total: Number(form.job_total) || 0,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
        last_correspondence: form.last_correspondence || null,
        notes: form.notes || null,
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
      <div className="drawer" role="dialog" aria-label={`Edit ${job.job_id}`}>
        <div className="drawer-head">
          <div>
            <h2>{job.job_id}</h2>
            <div className="sub">
              <span className="out">{money(job.outstanding)} outstanding</span> · created {shortDate(job.created_at)}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-tabs">
          <button className={`drawer-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button className={`drawer-tab${tab === 'progress' ? ' active' : ''}`} onClick={() => setTab('progress')}>Progress</button>
          <button className={`drawer-tab${tab === 'payments' ? ' active' : ''}`} onClick={() => setTab('payments')}>Payments</button>
          <button className={`drawer-tab${tab === 'messages' ? ' active' : ''}`} onClick={() => setTab('messages')}>Messages</button>
        </div>

        {tab === 'details' && (
          <>
            <div className="drawer-body">
              <div className="field">
                <label>Linked client <PortalTag /></label>
                <select value={form.client_id} onChange={set('client_id')}>
                  <option value="">— Not linked —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.email ? ` · ${c.email}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {linkedClient ? (
                <div className="client-card">
                  <div className="client-card-row"><span className="ck">Type</span><span className="cv">{linkedClient.type || '—'}</span></div>
                  <div className="client-card-row"><span className="ck">Email</span><span className="cv">{linkedClient.email || '—'}</span></div>
                  <div className="client-card-row"><span className="ck">Phone</span><span className="cv">{linkedClient.phone || '—'}</span></div>
                  {linkedClient.company && <div className="client-card-row"><span className="ck">Company</span><span className="cv">{linkedClient.company}</span></div>}
                  <div className="client-card-note">Shared with the client portal. Edit contact details on the client record.</div>
                </div>
              ) : (
                <div className="placeholder-note">Not linked to a client record — this job won't appear in the client portal. Pick a client above to connect it.</div>
              )}
              <div className="field">
                <label>Display name on this job</label>
                <input type="text" value={form.client_name} onChange={set('client_name')} />
              </div>
              <div className="field">
                <label>Address <PortalTag /></label>
                <input type="text" value={form.address} onChange={set('address')} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Phase <PortalTag /></label>
                  <select value={form.phase} onChange={set('phase')}>
                    {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Phase override (wins if set)</label>
                  <input type="text" value={form.phase_override} onChange={set('phase_override')} placeholder="optional label" />
                </div>
              </div>
              <div className="field-row">
                <div className="field mono-field">
                  <label>Job total ($)</label>
                  <input type="number" min="0" step="0.01" value={form.job_total} onChange={set('job_total')} />
                </div>
                <div className="field mono-field">
                  <label>FF commission ($)</label>
                  <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} disabled={!form.is_forefront} />
                </div>
              </div>
              <label className="check-field">
                <input type="checkbox" checked={form.bill_flag} onChange={set('bill_flag')} />
                Ready to bill
              </label>
              <label className="check-field">
                <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
                Forefront job (carries a commission)
              </label>
              <div className="field">
                <label>Last correspondence</label>
                <input type="text" value={form.last_correspondence} onChange={set('last_correspondence')} />
              </div>
              <div className="field">
                <label>Notes <InternalTag /></label>
                <textarea value={form.notes} onChange={set('notes')} />
              </div>
              {job.import_needs_review && (
                <div className="field">
                  <label className="review-flag">⚠ Import flagged this row for review</label>
                  <div className="placeholder-note">{job.import_notes || 'No import notes recorded.'}</div>
                </div>
              )}
            </div>
            <div className="drawer-foot">
              {error && <span className="error">{error}</span>}
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}

        {tab === 'progress' && (
          <ProgressTab job={job} onSave={onSave} />
        )}

        {tab === 'payments' && (
          <PaymentsTab job={job} onLogged={onPaymentLogged} />
        )}

        {tab === 'messages' && (
          <MessagesTab job={job} />
        )}
      </div>
    </>
  );
}
