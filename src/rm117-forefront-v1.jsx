// RM117 Forefront — commission tracker for referred / co-brokered jobs.
// Stat strip (booked / paid / owed) + a status-grouped ledger. Each row opens a
// drawer to log a commission payout to the partner.
import React, { useEffect, useState, useMemo } from 'react';
import { money, shortDate, PHASE_LABELS } from './lib/format.js';
import { apiFetch } from './lib/api.js';

const PAY_METHODS = ['check', 'venmo', 'zelle', 'cash', 'other'];

// Derive the per-row commission figures + which ledger group it belongs to.
// booked = total_commission; owed = booked − paid. A row with no commission
// amount yet is "accruing" (job has no billable contract value set).
function derive(c) {
  const booked = Number(c.total_commission || 0);
  const paid = Number(c.amount_paid || 0);
  const owed = Math.max(0, booked - paid);
  const group = booked <= 0 ? 'accruing' : owed > 0 ? 'outstanding' : 'paid';
  return { booked, paid, owed, group };
}

// Ledger groups, in display order. label + status-dot tone.
const GROUPS = [
  { key: 'outstanding', label: 'Outstanding commission', tone: 'warn' },
  { key: 'paid', label: 'Paid out', tone: 'success' },
  { key: 'accruing', label: 'Accruing — not yet billable', tone: 'muted' },
];

export default function ForefrountView() {
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null); // commission row

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/forefront');
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

  const rows = useMemo(() => commissions.map((c) => ({ ...c, ...derive(c) })), [commissions]);

  const stats = useMemo(() => {
    const booked = rows.reduce((s, r) => s + r.booked, 0);
    const paid = rows.reduce((s, r) => s + r.paid, 0);
    const owed = rows.reduce((s, r) => s + r.owed, 0);
    return {
      booked,
      paid,
      owed,
      paidPct: booked > 0 ? Math.round((paid / booked) * 100) : 0,
      activeReferrals: rows.filter((r) => r.booked > 0).length,
      flaggedTotal: rows.length,
      owedCount: rows.filter((r) => r.owed > 0).length,
    };
  }, [rows]);

  const byGroup = useMemo(() => {
    const m = { outstanding: [], paid: [], accruing: [] };
    for (const r of rows) m[r.group].push(r);
    return m;
  }, [rows]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Commission tracker</div>
          <h1 className="greeting">Forefront</h1>
        </div>
        <div className="page-meta">
          Commission tracking<br />
          Referred &amp; co-brokered work
        </div>
      </div>

      <div className="stat-strip">
        {/* Active referrals */}
        <div className="stat-cell">
          <div className="stat-top"><div className="label">Active<br />referrals</div></div>
          <div className="value">{stats.activeReferrals}<span className="unit">live</span></div>
          <div className="hint">{stats.flaggedTotal} flagged total</div>
        </div>

        {/* Commission booked */}
        <div className="stat-cell">
          <div className="stat-top"><div className="label">Commission<br />booked</div></div>
          <div className="value">{money(stats.booked)}</div>
          <div className="hint">total commission booked</div>
        </div>

        {/* Paid out */}
        <div className="stat-cell">
          <div className="stat-top">
            <div className="label">Paid out</div>
            <span className="stat-delta up">{stats.paidPct}%</span>
          </div>
          <div className="value">{money(stats.paid)}</div>
          <div className="stat-visual">
            <div className="progbar"><div className="progbar-fill ok" style={{ width: `${Math.min(100, stats.paidPct)}%` }} /></div>
          </div>
          <div className="hint">of {money(stats.booked)} booked</div>
        </div>

        {/* Outstanding */}
        <div className="stat-cell">
          <div className="stat-top">
            <div className="label">Outstanding</div>
            {stats.owedCount > 0 && <span className="stat-delta warn">{stats.owedCount}</span>}
          </div>
          <div className="value warn">{money(stats.owed)}</div>
          <div className="hint">commission owed to partners</div>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty">Loading commissions…</div></div>
      ) : error ? (
        <div className="card"><div className="empty">Error: {error}</div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty">No Forefront commission records yet.</div></div>
      ) : (
        <div className="ff-ledger">
          <div className="ff-colhead">
            <span>Job</span>
            <span>Partner</span>
            <span className="r">Commission</span>
            <span className="r">Owed</span>
            <span>Status</span>
          </div>
          {GROUPS.map(({ key, label, tone }) => {
            const groupRows = byGroup[key];
            if (groupRows.length === 0) return null;
            return (
              <div key={key} className="ff-group">
                <div className="ff-group-head">
                  <span className={`ff-dot ${tone}`} />
                  {label}
                  <span className="ff-count">{groupRows.length}</span>
                </div>
                {groupRows.map((r) => {
                  const job = r.jobs || {};
                  return (
                    <div key={r.id} className="ff-row" onClick={() => setDrawer(r)}>
                      <div className="ff-job">
                        <div className="ff-client">{job.client_name || r.job_id}</div>
                        <div className="ff-phase">{PHASE_LABELS[job.phase] || job.phase || '—'}</div>
                      </div>
                      <div className="ff-partner">Forefront</div>
                      <div className="ff-comm r">{r.booked > 0 ? money(r.booked) : '—'}</div>
                      <div className="ff-owed r">{r.owed > 0 ? money(r.owed) : '—'}</div>
                      <div>
                        {r.group === 'paid' && <span className="ff-pill success"><span className="ff-dot success" />Paid</span>}
                        {r.group === 'outstanding' && <span className="ff-pill warn"><span className="ff-dot warn" />Commission due</span>}
                        {r.group === 'accruing' && <span className="ff-pill muted"><span className="ff-dot muted" />Accruing</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

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
      const res = await apiFetch('/api/forefront', {
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

          {outstanding > 0 ? (
            <>
              <h3 style={{ fontSize: 13, marginBottom: 10 }}>Log a commission payout</h3>
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
                <div className="chip-row">
                  {PAY_METHODS.map((m) => (
                    <button key={m} type="button"
                      className={`chip${form.method === m ? ' active' : ''}`}
                      onClick={() => setForm((f) => ({ ...f, method: m }))}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <input type="text" value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </>
          ) : (
            <div className="placeholder-note">
              {Number(commission.total_commission || 0) > 0
                ? 'This commission is paid in full.'
                : 'No commission amount set yet — add a contract value / commission on the job first.'}
            </div>
          )}
        </div>

        {outstanding > 0 && (
          <div className="drawer-foot">
            {error && <span className="error">{error}</span>}
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={logPayment} disabled={saving || !form.amount}>
              {saving ? 'Saving…' : `Log ${form.amount ? money(Number(form.amount)) + ' ' : ''}payout`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
