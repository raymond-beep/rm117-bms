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
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money } from '../../lib/format.js';

// QBO service/non-inventory items on the real company — names must match the
// QuickBooks catalog EXACTLY (the API resolves the id by name), so these are the
// verbatim item names pulled from QBO (incl. their "(DP3)" / "(CA)" suffixes),
// ordered by typical project phase. "Custom…" lets staff type any other name.
const KNOWN_ITEMS = [
  'Project Retainer',
  'Survey + Existing Conditions Investigation',
  'Preliminary Design',
  'Design Development',
  'Design Phase I (DP1)',
  'Design Phase II (DPII)',
  'Design Phase III (DP3)',
  'Final Design',
  'Zoning Board of Adjustment (ZBA)',
  'Zoning Coordination',
  'variance package',
  'Preliminary Construction Documents',
  'Architectural Construction Documents',
  'Final Construction Documents',
  'Structural Engineer Engagement',
  'Construction Administration (CA)',
  'Hours',
];

const blankLine = () => ({ item_name: KNOWN_ITEMS[0], custom_name: '', amount: '', description: '' });
const isBlankLine = (l) => !l.amount && !l.description && !l.custom_name && l.item_name === KNOWN_ITEMS[0];

// Prefer a signed contract, then a sent one, then the most recently edited draft.
const STATUS_RANK = { signed: 2, sent: 1, draft: 0 };
function pickProposal(list = []) {
  return [...list].sort((a, b) =>
    (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0) ||
    String(b.updated_at).localeCompare(String(a.updated_at)),
  )[0] || null;
}
// A proposal fee line's label → the exact QBO catalog item, if one matches by name.
const matchItem = (label) =>
  KNOWN_ITEMS.find((n) => n.toLowerCase() === String(label || '').trim().toLowerCase()) || null;

export default function QboInvoicePanel({ job, onInvoiced }) {
  const [lines, setLines] = useState([blankLine()]);
  const [send, setSend] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [proposal, setProposal] = useState(null); // the job's contract, for the fee-schedule reference

  // Pull the job's saved proposal (if any) so staff can see the contracted fee
  // schedule while invoicing — the reference is best-effort and never blocks.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/proposals?job_id=${encodeURIComponent(job.job_id)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setProposal(pickProposal(data.proposals || []));
      } catch { /* the reference is optional */ }
    })();
    return () => { alive = false; };
  }, [job.job_id]);

  const setLine = (i, patch) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // Drop a contracted fee into the invoice: fill the first blank line, else append.
  const useFee = (fee) => {
    const known = matchItem(fee.label);
    const filled = {
      item_name: known || '__custom__',
      custom_name: known ? '' : (fee.label || ''),
      amount: fee.amount != null ? String(fee.amount) : '',
      description: '',
    };
    setLines((ls) => {
      const i = ls.findIndex(isBlankLine);
      return i >= 0 ? ls.map((l, idx) => (idx === i ? filled : l)) : [...ls, filled];
    });
  };

  const feeItems = Array.isArray(proposal?.content?.feeItems) ? proposal.content.feeItems : [];
  const addlServices = Array.isArray(proposal?.content?.additionalServices) ? proposal.content.additionalServices : [];
  const contractTotal = feeItems.reduce((s, f) => s + (Number(f.amount) || 0), 0);

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

      {feeItems.length > 0 && (
        <div className="qbo-proposal-ref">
          <div className="qbo-ref-head">
            <span className="qbo-ref-title">Contract fee schedule</span>
            <span className="qbo-ref-meta">from the {proposal.status} proposal</span>
          </div>
          {[
            ...feeItems.map((f, i) => ({ key: `f${i}`, fee: f, due: f.due ? String(f.due).replace(/^\s*[.:]?\s*/, '') : null })),
            ...addlServices.map((a, i) => ({ key: `a${i}`, fee: a, due: 'additional service' })),
          ].map(({ key, fee, due }) => (
            <div key={key} className="qbo-fee-row">
              <div className="qbo-fee-main">
                <span className="qbo-fee-label">{fee.label}</span>
                {due ? <span className="qbo-fee-due">{due}</span> : null}
              </div>
              <span className="qbo-fee-amt">{money(fee.amount, { cents: true })}</span>
              <button type="button" className="chip" onClick={() => useFee(fee)} title="Add this phase as an invoice line">Use</button>
            </div>
          ))}
          <div className="qbo-fee-total"><span>Contract total</span><span>{money(contractTotal, { cents: true })}</span></div>
        </div>
      )}

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
