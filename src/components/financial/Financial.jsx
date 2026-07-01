// Financial tab — firm-level money view, read from QuickBooks (read-only).
// Leads with Profit & Loss: the period stat strip, a quarter-over-quarter
// comparison chart (click a quarter to load its report), and top invoices /
// top expenses. Accounts receivable ("who owes us") sits underneath: outstanding
// total + aging buckets + the open-invoice list (sortable, filterable to 2025+).
// Data: GET /api/qbo/financials.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { money, fmtDateOnly } from '../../lib/format.js';

// 'YYYY-MM-DD' in local time.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// P&L period presets → { key, label, start, end }. A/R is always as-of-now.
const PRESETS = [
  { key: 'ytd', label: 'This year', range: (n) => [new Date(n.getFullYear(), 0, 1), n] },
  { key: 'this_quarter', label: 'This quarter', range: (n) => [new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1), n] },
  { key: 'this_month', label: 'This month', range: (n) => [new Date(n.getFullYear(), n.getMonth(), 1), n] },
  { key: 'last_month', label: 'Last month', range: (n) => [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] },
];
function presetPeriod(key) {
  const p = PRESETS.find((x) => x.key === key) || PRESETS[0];
  const [s, e] = p.range(new Date());
  return { key: p.key, label: p.label, start: isoDate(s), end: isoDate(e) };
}

// Which aging buckets read as "overdue" (drives the warn tone / count).
const OVERDUE_KEYS = new Set(['d1_30', 'd31_60', 'd61_90', 'd90_plus']);

export default function Financial() {
  const [period, setPeriod] = useState(() => presetPeriod('ytd'));
  const [arScope, setArScope] = useState('recent'); // 'recent' (2025+) | 'all'
  const [arSort, setArSort] = useState('overdue');   // 'overdue' | 'jobid'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(p, scope) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/qbo/financials?start=${p.start}&end=${p.end}&ar=${scope}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(period, arScope); }, [period, arScope]);

  const pnl = data?.pnl;
  const quarters = Array.isArray(data?.pnlQuarters) ? data.pnlQuarters : null;
  const topInvoices = Array.isArray(data?.topInvoices) ? data.topInvoices : [];
  const ar = data?.receivables;

  // Expenses shown = income − net income, so Income − Expenses = Net exactly
  // (folds in COGS and anything else between the top and bottom line).
  const expensesShown = pnl && !pnl.error ? Math.max(0, pnl.income - pnl.netIncome) : 0;
  const margin = pnl && pnl.income > 0 ? Math.round((pnl.netIncome / pnl.income) * 100) : null;

  const overdue = useMemo(() => {
    if (!ar?.buckets) return { amount: 0, count: 0 };
    return ar.buckets
      .filter((b) => OVERDUE_KEYS.has(b.key))
      .reduce((acc, b) => ({ amount: acc.amount + b.amount, count: acc.count + b.count }), { amount: 0, count: 0 });
  }, [ar]);

  // Client-side A/R sort (no refetch): most-overdue (server order) or by Job ID.
  const sortedInvoices = useMemo(() => {
    const list = ar?.invoices ? [...ar.invoices] : [];
    if (arSort === 'jobid') list.sort((a, b) => String(a.jobId).localeCompare(String(b.jobId), undefined, { numeric: true }));
    return list;
  }, [ar, arSort]);

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
          shows profit &amp; loss and outstanding A/R live from the company books.
        </div></div>
      ) : (
        <>
          {/* ── Profit & Loss (top) ───────────────────────────────────── */}
          <div className="fin-section-head">
            <h2>Profit &amp; loss</h2>
            <div className="fin-period">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`fin-period-btn${period.key === p.key ? ' active' : ''}`}
                  onClick={() => setPeriod(presetPeriod(p.key))}
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
              <div className="fin-period-caption">
                {period.label} · {fmtDateOnly(period.start)} – {fmtDateOnly(period.end)}
              </div>
              <div className="stat-strip fin-pnl-strip">
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Income</div></div>
                  <div className="value">{money(pnl.income)}</div>
                  <div className="hint">total revenue</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Expenses</div></div>
                  <div className="value">{money(expensesShown)}</div>
                  <div className="hint">all costs (incl. COGS)</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-top"><div className="label">Net income</div></div>
                  <div className={`value${pnl.netIncome < 0 ? ' warn' : ''}`}>{money(pnl.netIncome)}</div>
                  <div className="hint">{margin != null ? `${margin}% margin` : '—'}</div>
                </div>
              </div>

              {/* Quarter-over-quarter comparison */}
              {quarters && quarters.length > 0 && (
                <QuarterChart
                  quarters={quarters}
                  selected={period}
                  onSelect={(q) => setPeriod({ key: `q:${q.start}`, label: q.label, start: q.start, end: q.end })}
                />
              )}

              {/* Top invoices (small) · Top expenses (large) */}
              <div className="fin-pnl-detail">
                <TopInvoices invoices={topInvoices} />
                <AccountList title="Top expenses" accounts={pnl.expenseAccounts} large />
              </div>
            </>
          )}

          {/* ── Accounts receivable (below) ───────────────────────────── */}
          <div className="fin-section-head fin-ar-head">
            <h2>Accounts receivable</h2>
            <div className="fin-controls">
              <div className="fin-period" role="group" aria-label="A/R sort">
                <button className={`fin-period-btn${arSort === 'overdue' ? ' active' : ''}`} onClick={() => setArSort('overdue')}>Most overdue</button>
                <button className={`fin-period-btn${arSort === 'jobid' ? ' active' : ''}`} onClick={() => setArSort('jobid')}>Job ID</button>
              </div>
              <div className="fin-period" role="group" aria-label="A/R scope">
                <button className={`fin-period-btn${arScope === 'recent' ? ' active' : ''}`} onClick={() => setArScope('recent')}>2025 &amp; newer</button>
                <button className={`fin-period-btn${arScope === 'all' ? ' active' : ''}`} onClick={() => setArScope('all')}>All</button>
              </div>
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

              {sortedInvoices.length === 0 ? (
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
                  {sortedInvoices.map((inv) => (
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
        </>
      )}
    </div>
  );
}

// Quarter-over-quarter net-income bars around a zero baseline: green above (good
// quarter), warn below (a loss). Click a quarter to load its P&L into the section
// above. Heights scale to the largest absolute net in the window.
function QuarterChart({ quarters, selected, onSelect }) {
  const maxAbs = Math.max(1, ...quarters.map((q) => Math.abs(q.netIncome)));
  return (
    <div className="card fin-qcard">
      <div className="card-head"><h3>Net income by quarter</h3><span className="head-meta">CLICK TO OPEN</span></div>
      <div className="card-body">
        <div className="fin-quarters">
          {quarters.map((q) => {
            const active = selected.start === q.start && selected.end === q.end;
            const h = Math.round((Math.abs(q.netIncome) / maxAbs) * 44);
            const neg = q.netIncome < 0;
            return (
              <button
                key={q.start}
                className={`fin-q${active ? ' active' : ''}`}
                onClick={() => onSelect(q)}
                title={`${q.label}: income ${money(q.income)}, expenses ${money(q.income - q.netIncome)}, net ${money(q.netIncome)}`}
              >
                <div className={`fin-q-net${neg ? ' neg' : ''}`}>{money(q.netIncome)}</div>
                <div className="fin-q-chart">
                  <div className="fin-q-pos">{!neg && q.netIncome > 0 && <span className="fin-q-bar pos" style={{ height: `${h}px` }} />}</div>
                  <div className="fin-q-base" />
                  <div className="fin-q-neg">{neg && <span className="fin-q-bar neg" style={{ height: `${h}px` }} />}</div>
                </div>
                <div className="fin-q-label">{q.label}{q.partial ? <><br /><small>so far</small></> : ''}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Biggest invoices billed in the selected period (the smaller P&L widget).
function TopInvoices({ invoices }) {
  return (
    <div className="card fin-acct-card">
      <div className="card-head"><h3>Top invoices</h3></div>
      <div className="card-body">
        {invoices.length === 0 ? (
          <div className="empty">No invoices in this period.</div>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id || inv.docNumber} className="fin-acct-row">
              <span className="fin-acct-name">
                {inv.jobId}
                {inv.paid ? <span className="fin-paid-tag">paid</span> : null}
              </span>
              <span className="fin-acct-amt">{money(inv.amount)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// A ranked account list (top 8 by amount) with the remainder folded into one row.
function AccountList({ title, accounts, large = false }) {
  const rows = accounts || [];
  const top = rows.slice(0, large ? 10 : 6);
  const rest = rows.slice(large ? 10 : 6);
  const restTotal = rest.reduce((s, a) => s + a.amount, 0);
  return (
    <div className={`card fin-acct-card${large ? ' fin-acct-large' : ''}`}>
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
