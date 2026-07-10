// Financial tab — firm-level money view, read from QuickBooks (read-only).
// Leads with Profit & Loss on a chosen income basis (Sent | Paid | All invoiced):
// a period stat strip (Sent shows Total billed · Expenses · Unpaid invoices · Net
// income), a revenue-per-quarter comparison chart (click a quarter to load its
// report), and top invoices / top expenses. Accounts receivable ("who owes us")
// sits underneath: outstanding total + aging buckets + the open-invoice list
// (sortable, filterable to 2025+). Data: GET /api/qbo/financials.
import React, { useEffect, useMemo, useRef, useState } from 'react';
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

// Income bases — one row per toggle button; the caption tag and chart title read
// from here too, so a basis is named in exactly one place.
const BASES = [
  {
    key: 'sent', label: 'Sent', chartTitle: 'Billed vs collected by quarter',
    tag: 'Sent — billed for completed work',
    title: 'Invoices sent — billed for completed work, whether or not paid yet (how the firm tracks its books)',
  },
  {
    key: 'cash', label: 'Paid', chartTitle: 'Received by quarter',
    tag: 'Paid — money received',
    title: 'Money actually received',
  },
  {
    key: 'accrual', label: 'All invoiced', chartTitle: 'Invoiced by quarter',
    tag: 'All invoiced — every invoice created',
    title: 'Every invoice created, including ones drafted in advance',
  },
];

// Which aging buckets read as "overdue" (drives the warn tone / count).
const OVERDUE_KEYS = new Set(['d1_30', 'd31_60', 'd61_90', 'd90_plus']);

// Per-session cache of the last result for each query, so switching basis/period
// (or leaving the tab and coming back) paints instantly while we revalidate in the
// background — the server has its own short TTL cache too. Module-level so it
// survives the component unmounting when you navigate away. Bounded: `end` moves
// daily and quarter clicks add keys, so the oldest entries roll off.
const FIN_CACHE_MAX = 12;
const _finCache = new Map(); // qs -> data (insertion-ordered)
function finCacheSet(qs, data) {
  _finCache.delete(qs); // re-inserting moves it to newest
  _finCache.set(qs, data);
  while (_finCache.size > FIN_CACHE_MAX) _finCache.delete(_finCache.keys().next().value);
}

export default function Financial() {
  const [period, setPeriod] = useState(() => presetPeriod('ytd'));
  const [basis, setBasis] = useState('sent');        // 'sent' (billed) | 'cash' (received) | 'accrual' (created)
  const [arScope, setArScope] = useState('recent'); // 'recent' (2025+) | 'all'
  const [arSort, setArSort] = useState('overdue');   // 'overdue' | 'jobid'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);   // first-paint spinner only (no cached data yet)
  const [refreshing, setRefreshing] = useState(false); // background revalidate
  const [error, setError] = useState(null);

  // `fresh` forces past both caches (client + server) for the manual refresh.
  // A sequence counter drops superseded responses: rapid toggling leaves older
  // fetches in flight, and a late arrival must not paint over the newest one.
  const loadSeq = useRef(0);
  async function load(p, scope, b, fresh = false) {
    const seq = ++loadSeq.current;
    const qs = `start=${p.start}&end=${p.end}&ar=${scope}&basis=${b}`;
    const cached = !fresh && _finCache.get(qs);
    if (cached) { setData(cached); setLoading(false); } else { setLoading(true); }
    setError(null);
    setRefreshing(true);
    try {
      const res = await apiFetch(`/api/qbo/financials?${qs}${fresh ? '&fresh=1' : ''}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const freshData = await res.json();
      finCacheSet(qs, freshData);
      if (seq === loadSeq.current) setData(freshData);
    } catch (err) {
      if (seq === loadSeq.current && !cached) setError(err.message); // keep showing stale data if we have it
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setRefreshing(false); }
    }
  }
  useEffect(() => { load(period, arScope, basis); }, [period, arScope, basis]);

  const activeBasis = BASES.find((b) => b.key === basis) || BASES[0];
  const pnl = data?.pnl;
  const quarters = Array.isArray(data?.pnlQuarters) ? data.pnlQuarters : null;
  const topInvoices = Array.isArray(data?.topInvoices) ? data.topInvoices : [];
  const periodInvoices = Array.isArray(data?.periodInvoices) ? data.periodInvoices : null;
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
          {data?.configured === false ? (
            <span className="mock">Not connected</span>
          ) : (
            <>
              Live from QuickBooks<br />
              {data?.asOf ? `as of ${fmtDateOnly(data.asOf.slice(0, 10))}` : ''}
              {data && (
                <button
                  className="fin-refresh"
                  onClick={() => load(period, arScope, basis, true)}
                  disabled={refreshing}
                  title="Reload live from QuickBooks"
                >
                  {refreshing ? 'Refreshing…' : '↻ Refresh'}
                </button>
              )}
            </>
          )}
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
            <div className="fin-controls">
              <div className="fin-period" role="group" aria-label="Income basis">
                {BASES.map((b) => (
                  <button
                    key={b.key}
                    className={`fin-period-btn${basis === b.key ? ' active' : ''}`}
                    onClick={() => setBasis(b.key)}
                    title={b.title}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <div className="fin-period" role="group" aria-label="P&L period">
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
          </div>

          {pnl?.error ? (
            <div className="card"><div className="empty">Couldn’t load P&amp;L: {pnl.error}</div></div>
          ) : (
            <>
              <div className="fin-period-caption">
                {period.label} · {fmtDateOnly(period.start)} – {fmtDateOnly(period.end)}
                {' · '}
                <span className="fin-basis-tag">{activeBasis.tag}</span>
              </div>
              {/* One layout for every basis; Sent adds the Unpaid-invoices cell.
                  (pnl.income === pnl.sent.income on the sent basis by construction.) */}
              <div className="stat-strip fin-pnl-strip">
                <StatCell
                  label={pnl.sent ? 'Total billed' : 'Income'}
                  value={money(pnl.income)}
                  hint={pnl.sent
                    ? `${pnl.sent.count} invoice${pnl.sent.count === 1 ? '' : 's'} sent`
                    : basis === 'cash' ? 'received' : 'invoiced'}
                />
                <StatCell label="Expenses" value={money(expensesShown)} hint="all costs (incl. COGS)" />
                {pnl.sent && (
                  <StatCell
                    label={<>Unpaid<br />invoices</>}
                    value={money(pnl.sent.open)}
                    warn={pnl.sent.open > 0}
                    hint={`${money(pnl.sent.paid)} collected`}
                  />
                )}
                <StatCell
                  label="Net income"
                  value={money(pnl.netIncome)}
                  warn={pnl.netIncome < 0}
                  hint={margin != null ? `${margin}% margin` : '—'}
                />
              </div>

              {/* Revenue-per-quarter comparison (billed/received/invoiced — no expenses) */}
              {quarters && quarters.length > 0 && (
                <QuarterChart
                  quarters={quarters}
                  selected={period}
                  title={activeBasis.chartTitle}
                  onSelect={(q) => setPeriod({ key: `q:${q.start}`, label: q.label, start: q.start, end: q.end })}
                />
              )}
              {/* Sent basis: the full per-period invoice list (paid/unpaid) leads,
                  Top expenses below. Other bases keep Top invoices + Top expenses. */}
              {basis === 'sent' && periodInvoices ? (
                <div className="fin-pnl-stack">
                  <PeriodInvoices invoices={periodInvoices} periodLabel={period.label} />
                  <AccountList title="Top expenses" accounts={pnl.expenseAccounts} large />
                </div>
              ) : (
                <div className="fin-pnl-detail">
                  <TopInvoices invoices={topInvoices} />
                  <AccountList title="Top expenses" accounts={pnl.expenseAccounts} large />
                </div>
              )}
            </>
          )}

          {/* ── Accounts receivable (below) ───────────────────────────── */}
          <div className="fin-section-head fin-ar-head">
            <div>
              <h2>Accounts receivable</h2>
              <div className="fin-section-sub">Every unpaid invoice across all jobs, as of today — a collections snapshot, not tied to the quarter above.</div>
            </div>
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
                    <span>Phase / service</span>
                    <span>Invoice #</span>
                    <span>Due</span>
                    <span className="r">Age</span>
                    <span className="r">Open balance</span>
                  </div>
                  {sortedInvoices.map((inv) => (
                    <div key={inv.id || `${inv.docNumber}-${inv.dueDate}`} className="fin-row">
                      <span className="fin-job">{inv.jobId}</span>
                      <span className="fin-phase">{inv.description || '—'}</span>
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

// One P&L stat-strip cell (label over value over hint).
function StatCell({ label, value, hint, warn = false }) {
  return (
    <div className="stat-cell">
      <div className="stat-top"><div className="label">{label}</div></div>
      <div className={`value${warn ? ' warn' : ''}`}>{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

// Revenue-per-quarter bars. On the "Sent" basis each quarter draws TWO bars —
// billed (invoices sent that quarter) vs collected (how much of it has been paid) —
// so you can read the collection rate at a glance; other bases keep a single bar.
// Heights scale to the biggest billed quarter; click a quarter to load its P&L.
const MAX_BAR = 72; // px — tallest bar within the 96px chart area
function QuarterChart({ quarters, selected, onSelect, title }) {
  const grouped = quarters.some((q) => q.paid != null); // sent basis carries paid
  const max = Math.max(1, ...quarters.map((q) => q.income));
  return (
    <div className="card fin-qcard">
      <div className="card-head">
        <h3>{title}</h3>
        {grouped ? (
          <span className="fin-q-legend">
            <span className="fin-q-key billed">Billed</span>
            <span className="fin-q-key collected">Collected</span>
          </span>
        ) : (
          <span className="head-meta">CLICK TO OPEN</span>
        )}
      </div>
      <div className="card-body">
        <div className="fin-quarters">
          {quarters.map((q) => {
            const active = selected.start === q.start && selected.end === q.end;
            const hBilled = q.income > 0 ? Math.max(2, Math.round((q.income / max) * MAX_BAR)) : 0;
            const hPaid = grouped ? Math.round((Math.max(0, q.paid) / max) * MAX_BAR) : 0;
            const pct = grouped && q.income > 0 ? Math.round((q.paid / q.income) * 100) : null;
            const tip = grouped
              ? `${q.label}: billed ${money(q.income)}, collected ${money(q.paid)}${pct != null ? ` (${pct}%)` : ''}`
              : `${q.label}: billed ${money(q.income)}, expenses ${money(q.income - q.netIncome)}, net ${money(q.netIncome)}`;
            return (
              <button
                key={q.start}
                className={`fin-q${active ? ' active' : ''}`}
                onClick={() => onSelect(q)}
                title={tip}
              >
                <div className="fin-q-net">{money(q.income)}</div>
                <div className="fin-q-chart">
                  <div className="fin-q-pos">
                    {grouped ? (
                      <div className="fin-q-bars">
                        <span className="fin-q-bar billed" style={{ height: `${hBilled}px` }} />
                        <span className="fin-q-bar collected" style={{ height: `${hPaid}px` }} />
                      </div>
                    ) : (
                      q.income > 0 && <span className="fin-q-bar pos" style={{ height: `${hBilled}px` }} />
                    )}
                  </div>
                  <div className="fin-q-base" />
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

// Every invoice sent in the selected period, split Unpaid (open balance) then Paid,
// so you can reconcile the quarter's billed/collected bars against real invoices.
// Each row: Job ID · invoice # · sent date · billed amount · open balance (or "paid").
function PeriodInvoices({ invoices, periodLabel }) {
  const unpaid = invoices.filter((i) => !i.paid);
  const paid = invoices.filter((i) => i.paid);
  const openTotal = unpaid.reduce((s, i) => s + i.balance, 0);
  const paidBilled = paid.reduce((s, i) => s + i.amount, 0);
  const Row = (inv) => (
    <div key={inv.id || `${inv.docNumber}-${inv.sentDate}`} className="fin-row">
      <span className="fin-job">{inv.jobId}</span>
      <span className="fin-phase">{inv.description || '—'}</span>
      <span className="fin-doc">{inv.docNumber ? `#${inv.docNumber}` : '—'}</span>
      <span className="fin-due">{fmtDateOnly(inv.sentDate)}</span>
      <span className="r fin-amt">{money(inv.amount)}</span>
      <span className="r">
        {inv.paid
          ? <span className="fin-paid-inline">paid</span>
          : <span className="fin-amt warn">{money(inv.balance)}</span>}
      </span>
    </div>
  );
  return (
    <div className="card fin-inv-card">
      <div className="card-head">
        <h3>Invoices sent · {periodLabel}</h3>
        <span className="head-meta">{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</span>
      </div>
      <div className="card-body">
        {invoices.length === 0 ? (
          <div className="empty">No invoices sent in this period.</div>
        ) : (
          <div className="fin-table fin-inv-table">
            <div className="fin-colhead">
              <span>Job / customer</span>
              <span>Phase / service</span>
              <span>Invoice #</span>
              <span>Sent</span>
              <span className="r">Billed</span>
              <span className="r">Open balance</span>
            </div>
            {unpaid.length > 0 && (
              <div className="fin-inv-group warn">
                <span>Unpaid · {unpaid.length}</span>
                <span className="fin-inv-group-amt">{money(openTotal)} open</span>
              </div>
            )}
            {unpaid.map(Row)}
            {paid.length > 0 && (
              <div className="fin-inv-group ok">
                <span>Paid · {paid.length}</span>
                <span className="fin-inv-group-amt">{money(paidBilled)} collected</span>
              </div>
            )}
            {paid.map(Row)}
          </div>
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
