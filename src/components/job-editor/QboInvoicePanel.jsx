// "Send to QuickBooks" — create a QBO invoice for this job from inside the app.
//
// Outbound half of the two-way sync: POSTs to /api/qbo/create-invoice, which
// find-or-creates the QBO customer (DisplayName === Job ID) and creates the
// invoice against the firm's real QuickBooks company. The inbound half (a paid
// invoice → a payments row) arrives later via the Zapier webhook and shows up in
// the list above. Renders only when /api/qbo/status reports configured — so the
// whole feature stays hidden until the QBO creds are seeded (the flag).
//
// Billing modes both work here (Ray, 2026-06-28): one line = pay-in-full; several
// lines = per-milestone. Lines bill against QBO service items by name.
import React, { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money } from '../../lib/format.js';

// QBO service items on the real company (by name — the API resolves the id).
// Mirrors the catalog noted in api/_lib/qbo.js; "Custom…" lets staff type any name.
const KNOWN_ITEMS = [
  'Project Retainer',
  'Final Design',
  'Design Phase III',
  'Architectural Construction Documents',
  'Final Construction Documents',
  'Zoning Board of Adjustment',
  'Zoning Coordination',
  'Structural Engineer Engagement',
  'Construction Administration',
  'Hours',
];

const blankLine = () => ({ item_name: KNOWN_ITEMS[0], custom_name: '', amount: '', description: '' });

export default function QboInvoicePanel({ job, onInvoiced }) {
  const [lines, setLines] = useState([blankLine()]);
  const [send, setSend] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const setLine = (i, patch) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const ready = lines.every((l) => Number(l.amount) > 0 && (l.item_name !== '__custom__' || l.custom_name.trim()));

  async function createInvoice() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        job_id: job.job_id,
        send,
        due_date: dueDate || undefined,
        lines: lines.map((l) => ({
          item_name: l.item_name === '__custom__' ? l.custom_name.trim() : l.item_name,
          amount: Number(l.amount),
          description: l.description || undefined,
        })),
      };
      const res = await apiFetch('/api/qbo/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setLines([blankLine()]);
      setSend(false);
      setDueDate('');
      onInvoiced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qbo-invoice">
      <div className="pay-form-title">Send to QuickBooks</div>
      <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
        Creates a real QuickBooks invoice for <code>{job.job_id}</code> (customer auto-created if needed).
        Add one line to bill in full, or several to bill by milestone.
      </div>

      {result && (
        <div className="placeholder-note" style={{ color: '#15803d', padding: '0 0 10px' }}>
          ✅ Created QBO invoice{result.doc_number ? ` #${result.doc_number}` : ''} for{' '}
          {money(result.total, { cents: true })}{result.sent ? ' · emailed to client' : ''}.
        </div>
      )}

      {lines.map((l, i) => (
        <div key={i} className="qbo-line">
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Item</label>
              <select
                value={l.item_name}
                onChange={(e) => setLine(i, { item_name: e.target.value })}
              >
                {KNOWN_ITEMS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Amount ($)</label>
              <input
                type="number" min="0" step="0.01" value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
              />
            </div>
            {lines.length > 1 && (
              <button type="button" className="chip" style={{ alignSelf: 'flex-end', marginBottom: 2 }}
                onClick={() => removeLine(i)} title="Remove line">✕</button>
            )}
          </div>
          {l.item_name === '__custom__' && (
            <div className="field">
              <label>Custom item name (must match a QuickBooks item)</label>
              <input type="text" value={l.custom_name}
                onChange={(e) => setLine(i, { custom_name: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label>Description (optional)</label>
            <input type="text" value={l.description}
              onChange={(e) => setLine(i, { description: e.target.value })} />
          </div>
        </div>
      ))}

      <div className="field-row">
        <button type="button" className="chip" onClick={addLine}>+ Add line</button>
        <div className="field" style={{ flex: 1 }}>
          <label>Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <label className="chip-row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
        Email the invoice to the client now
      </label>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      <button className="btn btn-primary" style={{ marginTop: 10 }}
        onClick={createInvoice} disabled={busy || !ready}>
        {busy ? 'Creating…' : `Create QBO invoice${total > 0 ? ` · ${money(total)}` : ''}`}
      </button>
    </div>
  );
}
