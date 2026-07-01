// Financial tab — firm-level money view, read from QuickBooks (read-only).
// Leads with A/R aging ("who owes us"): total outstanding + aging buckets +
// the open-invoice list, most-overdue first. Below that, a Profit & Loss summary
// for a selectable period. Data comes from GET /api/qbo/financials; the tab shows
// a friendly connect state when QBO isn't configured.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money, fmtDateOnly } from '../../lib/format.js';

// P&L period presets → [start, end] as 'YYYY-MM-DD' (local). A/R is always as-of-now.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PERIODS = [
  {
    key: 'ytd', label: 'This year',
    range: (now) => [isoDate(new Date(now.getFullYear(), 0, 1)), isoDate(now)],
  },
  {
    key: 'this_month', label: 'This month',
    range: (now) => [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), isoDate(now)],
  },
  {
    key: 'last_month', label: 'Last month',
    range: (now) => [
      isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    ],
  },
  {
    key: 'this_quarter', label: 'This quarter',
    range: (now) => [isoDate(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), isoDate(now)],
  },
];

// Which aging buckets read as "overdue" (drives the warn tone / count).
const OVERDUE_KEYS = new Set(['d1_30', 'd31_60', 'd61_90', 'd90_plus']);

export default function Financial() {
  const [periodKey, setPeriodKey] = useState('ytd');
  // A/R scope: 'recent' (2025+ jobs, default — pre-2025 QBO data is being cleaned
  // up and may be stale) or 'all' (the full open A/R book).
  const [arScope, setArScope] = useState('recent');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(key, scope) {
    setLoading(true);
    setError(null);
    try {
      const [start, end] = (PERIODS.find((p) => p.key === key) || PERIODS[0]).range(new Date());
      const res = await apiFetch(`/api/qbo/financials?start=${start}&end=${end}&ar=${scope}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(periodKey, arScope); }, [periodKey, arScope]);

  const ar = data?.receivables;
  const pnl = data?.pnl;

  const overdue = useMemo(() => {
    if (!ar?.buckets) return { amount: 0, count: 0 };
    return ar.buckets
      .filter((b) => OVERDUE_KEYS.has(b.key))
      .reduce((acc, b) => ({ amount: acc.amount + b.amount, count: acc.count + b.count }), { amount: 0, count: 0 });
  }, [ar]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Financials · QuickBooks</div>
          <h1 className="greeting">Financial</h1>
        </div>
        <div className="page-meta">
          {data?.configured === false
            ? <span className="mock">Not connected</span>
            : <>Live from QuickBooks<br />{data?.asOf ? `as of ${fmtDateOnly(data.asOf.slice(0, 10))}` : ''}</>}
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty">Loading financials…</div></div>
      ) : error ? (
        <div className="card"><div className="empty">Error: {error}</div></div>
      ) : data?.configured === false ? (
        <div className="card"><div className="empty">
          QuickBooks isn’t connected yet. Once the QBO credentials are set, this tab
          shows outstanding A/R and profit &amp; loss live from the company books.
        </div></div>
      ) : (
        <>
          {/* ── A/R aging ─────────────────────────────────────────────── */}
          <div className="fin-section-head">
            <h2>Accounts receivable</h2>
            <div className="fin-period">
              <button
                className={`fin-period-btn${arScope === 'recent' ? ' active' : ''}`}
                onClick={() => setArScope('recent')}
              >
                2025 &amp; newer
              </button>
              <button
                className={`fin-period-btn${arScope === 'all' ? ' active' : ''}`}
                onClick={() => setArScope('all')}
              >
                All invoices
              </button>
            </div>
          </div>

          {ar?.error ? (
            <div className="card"><div className="empty">Couldn’t load A/R: {ar.error}</div></div>
          ) : (
            <>
              <div className="stat-strip">
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Outstanding<br />A/R</div></div>
                  <div className="value">{money(ar.total)}</div>
                  <div className="hint">{ar.invoices.length} open invoice{ar.invoices.length === 1 ? '' : 's'}</div>
                </div>
                {ar.buckets.map((b) => {
                  const warn = OVERDUE_KEYS.has(b.key) && b.amount > 0;
                  const worst = b.key === 'd90_plus' && b.amount > 0;
                  return (
                    <div key={b.key} className="stat-cell">
                      <div className="stat-top">
                        <div className="label">{b.label}</div>
                        {worst && <span className="stat-delta warn">!</span>}
                      </div>
                      <div className={`value${warn ? ' warn' : ''}`}>{money(b.amount)}</div>
                      <div className="hint">{b.count} invoice{b.count === 1 ? '' : 's'}</div>
                    </div>
                  );
                })}
              </div>

              {overdue.amount > 0 && (
                <div className="fin-note warn">
                  <span className="ff-dot warn" />
                  {money(overdue.amount)} past due across {overdue.count} invoice{overdue.count === 1 ? '' : 's'}.
                </div>
              )}

              {arScope === 'recent' && ar.hidden?.count > 0 && (
                <div className="fin-note">
                  <span className="ff-dot muted" />
                  {ar.hidden.count} older invoice{ar.hidden.count === 1 ? '' : 's'} (2024 &amp; earlier —{' '}
                  {money(ar.hidden.amount)}) hidden pending QuickBooks cleanup.{' '}
                  <button className="fin-link" onClick={() => setArScope('all')}>Show all</button>
                </div>
              )}

              {ar.invoices.length === 0 ? (
                <div className="card"><div className="empty">No open invoices — everything’s paid up. 🎉</div></div>
              ) : (
                <div className="fin-table">
                  <div className="fin-colhead">
                    <span>Job / customer</span>
                    <span>Invoice</span>
                    <span>Due</span>
                    <span className="r">Age</span>
                    <span className="r">Open balance</span>
                  </div>
                  {ar.invoices.map((inv) => (
                    <div key={inv.id || `${inv.docNumber}-${inv.dueDate}`} className="fin-row">
                      <span className="fin-job">{inv.jobId}</span>
                      <span className="fin-doc">{inv.docNumber ? `#${inv.docNumber}` : '—'}</span>
                      <span className="fin-due">{fmtDateOnly(inv.dueDate)}</span>
                      <span className="r">
                        {inv.daysPastDue > 0
                          ? <span className="fin-age warn">{inv.daysPastDue}d</span>
                          : <span className="fin-age">current</span>}
                      </span>
                      <span className="r fin-amt">{money(inv.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Profit & Loss ─────────────────────────────────────────── */}
          <div className="fin-section-head">
            <h2>Profit &amp; loss</h2>
            <div className="fin-period">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  className={`fin-period-btn${periodKey === p.key ? ' active' : ''}`}
                  onClick={() => setPeriodKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {pnl?.error ? (
            <div className="card"><div className="empty">Couldn’t load P&amp;L: {pnl.error}</div></div>
          ) : (
            <>
              <div className="stat-strip fin-pnl-strip">
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Income</div></div>
                  <div className="value">{money(pnl.income)}</div>
                  <div className="hint">{data?.period ? `${fmtDateOnly(data.period.start)} – ${fmtDateOnly(data.period.end)}` : ''}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Expenses</div></div>
                  <div className="value">{money(pnl.expense)}</div>
                  <div className="hint">including cost of goods sold</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Net income</div></div>
                  <div className={`value${pnl.netIncome < 0 ? ' warn' : ''}`}>{money(pnl.netIncome)}</div>
                  <div className="hint">{pnl.income > 0 ? `${Math.round((pnl.netIncome / pnl.income) * 100)}% margin` : '—'}</div>
                </div>
              </div>

              <div className="grid-2 fin-accounts">
                <AccountList title="Top income" accounts={pnl.incomeAccounts} />
                <AccountList title="Top expenses" accounts={pnl.expenseAccounts} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// A compact ranked account list (top 6 by amount) with the rest folded into a
// remainder row so a long chart of accounts stays readable.
function AccountList({ title, accounts }) {
  const rows = accounts || [];
  const top = rows.slice(0, 6);
  const rest = rows.slice(6);
  const restTotal = rest.reduce((s, a) => s + a.amount, 0);
  return (
    <div className="card fin-acct-card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="card-body">
        {rows.length === 0 ? (
          <div className="empty">No accounts in this period.</div>
        ) : (
          <>
            {top.map((a) => (
              <div key={a.label} className="fin-acct-row">
                <span className="fin-acct-name">{a.label}</span>
                <span className="fin-acct-amt">{money(a.amount)}</span>
              </div>
            ))}
            {rest.length > 0 && (
              <div className="fin-acct-row muted">
                <span className="fin-acct-name">+{rest.length} more</span>
                <span className="fin-acct-amt">{money(restTotal)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
