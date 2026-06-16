// RM117 Forefront Commissions view — Phase 6.
// Lists all FF jobs with commission totals, amount paid, outstanding.
// Drawer for logging commission payments per job.
import React, { useEffect, useState, useMemo } from 'react';
import { money, shortDate, PHASE_LABELS } from './lib/format.js';

const PAY_METHODS = ['check', 'venmo', 'zelle', 'qb', 'cash', 'other'];

export default function ForefrountView() {
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null); // commission row
  const [statusFilter, setStatusFilter] = useState('active');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/forefront');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setCommissions(data.commissions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return commissions;
    return commissions.filter((c) => c.status === statusFilter);
  }, [commissions, statusFilter]);

  const stats = useMemo(() => {
    const active = commissions.filter((c) => c.status !== 'closed');
    const totalOwed = active.reduce((s, c) => s + Number(c.total_commission || 0), 0);
    const totalPaid = active.reduce((s, c) => s + Number(c.amount_paid || 0), 0);
    return {
      count: active.length,
      totalOwed,
      totalPaid,
      outstanding: totalOwed - totalPaid,
    };
  }, [commissions]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Forefront</div>
          <h1 className="greeting">Commissions</h1>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="label">Active FF jobs</div>
          <div className="value">{stats.count}</div>
          <div className="hint">with commission tracking</div>
        </div>
        <div className="stat-cell">
          <div className="label">Total owed</div>
          <div className="value">{money(stats.totalOwed)}</div>
          <div className="hint">sum of all commissions</div>
        </div>
        <div className="stat-cell">
          <div className="label">Total paid</div>
          <div className="value">{money(stats.totalPaid)}</div>
          <div className="hint">commission payments logged</div>
        </div>
        <div className="stat-cell">
          <div className="label">Outstanding</div>
          <div className="value" style={{ color: stats.outstanding > 0 ? 'var(--warn)' : 'var(--success)' }}>
            {money(stats.outstanding)}
          </div>
          <div className="hint">commissions still owed</div>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: 'flex', gap: 8 }}>
          {['active', 'completed', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={'view-btn' + (statusFilter === s ? ' active' : '')}
              style={{ textTransform: 'capitalize' }}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty">Loading commissions…</div>
        ) : error ? (
          <div className="empty">Error: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No {statusFilter !== 'all' ? statusFilter : ''} commission records found.</div>
        ) : (
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Job / Client</th>
                <th>Phase</th>
                <th className="num">Commission</th>
                <th className="num">Paid</th>
                <th className="num">Outstanding</th>
                <th>Last payment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const outstanding = Number(c.total_commission || 0) - Number(c.amount_paid || 0);
                const history = Array.isArray(c.payment_history) ? c.payment_history : [];
                const lastPayment = history.length > 0 ? history[history.length - 1] : null;
                const job = c.jobs || {};
                return (
                  <tr key={c.id} onClick={() => setDrawer(c)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{job.client_name || '—'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.job_id}</div>
                      {job.address && <div className="muted" style={{ fontSize: 12 }}>{job.address}</div>}
                    </td>
                    <td>
                      <span className={'badge badge-' + (job.phase || 'potential')}>
                        {PHASE_LABELS[job.phase] || job.phase || '—'}
                      </span>
                    </td>
                    <td className="num">{money(c.total_commission)}</td>
                    <td className="num">{money(c.amount_paid)}</td>
                    <td className={'num ' + (outstanding > 0 ? 'outstanding-pos' : 'outstanding-zero')}>
                      {money(outstanding)}
                    </td>
                    <td className="muted">
                      {lastPayment ? (
                        <>
                          {money(lastPayment.amount)} · {lastPayment.method}
                          <div style={{ fontSize: 12 }}>{shortDate(lastPayment.date)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      {c.status === 'active' && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={(e) => { e.stopPropagation(); setDrawer(c); }}
                        >
                          Log payment
                        </button>
                      )}
                      {c.status === 'completed' && (
                        <span className="badge" style={{ background: '#e6f4ed', color: 'var(--success)', fontSize: 11 }}>Paid in full</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawer && (
        <CommissionDrawer
          commission={drawer}
          onClose={() => setDrawer(null)}
          onLogged={() => { setDrawer(null); load(); }}
        />
      )}
    </div>
  );
}

function CommissionDrawer({ commission, onClose, onLogged }) {
  const job = commission.jobs || {};
  const history = Array.isArray(commission.payment_history) ? commission.payment_history : [];
  const outstanding = Number(commission.total_commission || 0) - Number(commission.amount_paid || 0);

  const [form, setForm] = useState({
    amount: outstanding > 0 ? String(outstanding) : '',
    date: new Date().toISOString().slice(0, 10),
    method: 'check',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function logPayment() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/forefront', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: commission.job_id, ...form, amount: Number(form.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      onLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog">
        <div className="drawer-head">
          <div>
            <h2>{job.client_name || commission.job_id}</h2>
            <div className="sub">{commission.job_id} · {money(outstanding)} outstanding commission</div>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span className="muted">Total commission</span>
              <strong>{money(commission.total_commission)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span className="muted">Amount paid</span>
              <strong>{money(commission.amount_paid)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
              <span>Outstanding</span>
              <span style={{ color: outstanding > 0 ? 'var(--warn)' : 'var(--success)' }}>{money(outstanding)}</span>
            </div>
          </div>

          {history.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, marginBottom: 10 }}>Payment history</h3>
              <ul className="pay-list" style={{ marginBottom: 20 }}>
                {history.map((p, i) => (
                  <li key={i}>
                    <span>
                      <strong>{money(p.amount)}</strong>
                      <span className="meta"> · {p.method}</span>
                      {p.notes && <div className="meta">{p.notes}</div>}
                    </span>
                    <span className="meta">{shortDate(p.date)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {commission.status === 'active' && (
            <>
              <h3 style={{ fontSize: 13, marginBottom: 10 }}>Log a payment</h3>
              <div className="field-row">
                <div className="field">
                  <label>Amount ($)</label>
                  <input type="number" min="0" step="0.01" value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div className="field">
                <label>Method</label>
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Notes</label>
                <input type="text" value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </>
          )}
        </div>

        {commission.status === 'active' && (
          <div className="drawer-foot">
            {error && <span className="error">{error}</span>}
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={logPayment} disabled={saving || !form.amount}>
              {saving ? 'Saving…' : 'Log payment'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
