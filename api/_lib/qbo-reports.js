// Pure QBO report/query → normalized-shape transforms for the Financial tab.
//
// Kept dependency-free (no db, no network) so it unit-tests cleanly and the API
// endpoint (api/qbo/financials.js) stays a thin fetch-then-transform wrapper.
// Two inputs, from api/_lib/qbo.js:
//   • summarizeReceivables() ← the raw Invoice list from `Invoice where Balance > 0`
//   • parseProfitAndLoss()   ← QBO's ProfitAndLoss report JSON (reports/ProfitAndLoss)
//
// We derive A/R aging ourselves from open invoices rather than parse QBO's
// AgedReceivableDetail report — the invoice query is a clean structured list, and
// computing buckets from DueDate gives us the invoice-level list AND the bucket
// totals from one call, matching exactly what the UI renders.

// Aging buckets, in display order. `test(days)` decides which bucket a given
// days-past-due lands in (only one matches; evaluated top → bottom).
export const AGING_BUCKETS = [
  { key: 'current', label: 'Current',    test: (d) => d <= 0 },
  { key: 'd1_30',   label: '1–30 days',  test: (d) => d >= 1 && d <= 30 },
  { key: 'd31_60',  label: '31–60 days', test: (d) => d >= 31 && d <= 60 },
  { key: 'd61_90',  label: '61–90 days', test: (d) => d >= 61 && d <= 90 },
  { key: 'd90_plus', label: '90+ days',  test: (d) => d > 90 },
];

// Parse a 'YYYY-MM-DD' (or ISO) date to a local midnight Date, so day-count math
// isn't skewed by a UTC parse in a negative-offset timezone. Returns null on junk.
function localMidnight(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Whole days from `due` to `asOf` (positive = past due, negative = not yet due).
function daysBetween(due, asOf) {
  const ms = asOf.getTime() - due.getTime();
  return Math.floor(ms / 86_400_000);
}

// Normalize one raw QBO Invoice into the flat shape the UI table wants. By the
// Job-ID invariant the QBO Customer DisplayName === the Job ID, so `jobId` is the
// customer name. `amount` is the still-open Balance (not the original TotalAmt).
export function normalizeInvoice(inv, asOf) {
  const dueRaw = inv.DueDate || inv.TxnDate || null;
  const due = localMidnight(dueRaw);
  const daysPastDue = due ? daysBetween(due, asOf) : 0;
  const bucket = (AGING_BUCKETS.find((b) => b.test(daysPastDue)) || AGING_BUCKETS[0]).key;
  const customer = inv.CustomerRef?.name || inv.CustomerRef?.value || '—';
  return {
    id: inv.Id != null ? String(inv.Id) : null,
    docNumber: inv.DocNumber || null,
    customer,
    jobId: customer, // invariant: DisplayName === Job ID
    txnDate: inv.TxnDate || null,
    dueDate: dueRaw,
    total: Number(inv.TotalAmt || 0),
    amount: Number(inv.Balance || 0), // open balance
    daysPastDue,
    bucket,
  };
}

// Extract the two-digit year prefix of a Job ID (the QBO Customer DisplayName):
// '25_054_McCalla' → 25, '24_008_Dunn_Fritchey' → 24. Returns null for a customer
// name that doesn't follow the Job-ID convention (legacy / one-off QBO entries).
// Used by the Financial tab's "recent invoices" filter — pre-2025 (24 & older)
// QBO data is being cleaned up and may be stale, so it's hidden by default.
export function jobIdYear(name) {
  const m = /^(\d{2})_/.exec(String(name || '').trim());
  return m ? Number(m[1]) : null;
}

// Roll a raw open-invoice list into { total, buckets, invoices, hidden }.
//   total    — sum of open balances (of the *shown* invoices)
//   buckets  — [{ key, label, amount, count }] in AGING_BUCKETS order
//   invoices — normalized + shown, most-overdue first (largest amount breaks ties)
//   hidden   — { count, amount } filtered out by minJobYear (0/0 when no filter)
// `asOf` defaults to today; pass a fixed Date in tests. When `minJobYear` is set,
// invoices whose Job ID year is below it — or that have no Job-ID year at all
// (legacy/one-off customers) — are excluded from totals/buckets and rolled into
// `hidden` instead, so the caller can show "N older invoices hidden — $X".
export function summarizeReceivables(rawInvoices = [], asOf = new Date(), { minJobYear = null } = {}) {
  const open = (rawInvoices || [])
    .map((inv) => normalizeInvoice(inv, asOf))
    .filter((inv) => inv.amount > 0);

  let invoices = open;
  let hidden = { count: 0, amount: 0 };
  if (minJobYear != null) {
    const shown = [];
    let hiddenAmount = 0;
    let hiddenCount = 0;
    for (const inv of open) {
      const yr = jobIdYear(inv.jobId);
      if (yr != null && yr >= minJobYear) {
        shown.push(inv);
      } else {
        hiddenCount += 1;
        hiddenAmount += inv.amount;
      }
    }
    invoices = shown;
    hidden = { count: hiddenCount, amount: round2(hiddenAmount) };
  }

  const bucketMap = new Map(AGING_BUCKETS.map((b) => [b.key, { key: b.key, label: b.label, amount: 0, count: 0 }]));
  let total = 0;
  for (const inv of invoices) {
    total += inv.amount;
    const b = bucketMap.get(inv.bucket);
    b.amount += inv.amount;
    b.count += 1;
  }

  invoices.sort((a, b) => b.daysPastDue - a.daysPastDue || b.amount - a.amount);

  return {
    total: round2(total),
    buckets: AGING_BUCKETS.map((b) => {
      const v = bucketMap.get(b.key);
      return { ...v, amount: round2(v.amount) };
    }),
    invoices: invoices.map((inv) => ({ ...inv, amount: round2(inv.amount), total: round2(inv.total) })),
    hidden,
  };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Profit & Loss ─────────────────────────────────────────────────────────────
// QBO's ProfitAndLoss report is a tree of sections keyed by a `group` field
// ('Income', 'COGS', 'GrossProfit', 'Expenses', 'NetOperatingIncome',
// 'OtherIncome', 'OtherExpense', 'NetOtherIncome', 'NetIncome'). Section totals
// live on `section.Summary.ColData`; leaf account rows are `type:'Data'` rows.
// We pull the top-level section totals plus the leaf income/expense accounts (for
// the "top accounts" breakdown). Amount is always the last column.

const lastColValue = (colData) => {
  if (!Array.isArray(colData) || colData.length === 0) return 0;
  return Number(colData[colData.length - 1]?.value || 0);
};

// Recursively collect leaf Data rows (label + amount) under a section.
function collectLeafRows(rowContainer, out) {
  const rows = rowContainer?.Row;
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (row.type === 'Data' && Array.isArray(row.ColData)) {
      const label = row.ColData[0]?.value || '';
      const amount = lastColValue(row.ColData);
      if (label) out.push({ label, amount: round2(amount) });
    }
    if (row.Rows) collectLeafRows(row.Rows, out); // nested sub-sections
  }
}

// 'YYYY-MM-DD' (quarter start) → 'Q3 2026'.
export function quarterLabel(startISO) {
  const [y, m] = String(startISO || '').slice(0, 10).split('-').map(Number);
  if (!y || !m) return '';
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

// Parse a period-summarized ProfitAndLoss (summarize_column_by=Quarter/Month) into
// one row per period column: [{ start, end, label, income, expense, netIncome }].
// QBO lays the report out as columns — column 0 is the account label, then one
// Money column per period (each carrying StartDate/EndDate in MetaData), then a
// grand "Total" column (which has no StartDate — that's how we skip it). Section
// totals live on each top-level section's Summary.ColData, index-aligned to the
// columns. Newest period last (QBO's order).
export function parseProfitAndLossColumns(report) {
  const cols = report?.Columns?.Column || [];
  const periods = [];
  cols.forEach((c, index) => {
    if (c.ColType !== 'Money') return;
    const md = Object.fromEntries((c.MetaData || []).map((m) => [m.Name, m.Value]));
    if (!md.StartDate) return; // the grand-Total column has no StartDate — skip it
    periods.push({ index, start: md.StartDate, end: md.EndDate || null });
  });

  const summaryByGroup = {};
  for (const section of report?.Rows?.Row || []) {
    if (section.group && section.Summary?.ColData) summaryByGroup[section.group] = section.Summary.ColData;
  }
  const valAt = (group, index) => Number(summaryByGroup[group]?.[index]?.value || 0);

  return periods.map((p) => {
    const income = round2(valAt('Income', p.index));
    const cogs = round2(valAt('COGS', p.index));
    const expense = round2(valAt('Expenses', p.index));
    const netIncome = summaryByGroup.NetIncome
      ? round2(valAt('NetIncome', p.index))
      : round2(income - cogs - expense);
    return { start: p.start, end: p.end, label: quarterLabel(p.start), income, expense, netIncome };
  });
}

// ── "Sent" income (how the firm actually tracks it) ───────────────────────────
// The firm counts income when an invoice is *sent* to the client (work completed →
// billed), whether or not it's been paid yet — distinct from QBO's cash basis
// (paid) and accrual basis (every invoice created, incl. ones drafted in advance).
// QBO stamps the real send timestamp on DeliveryInfo.DeliveryTime when it emails an
// invoice, so we date each invoice by that, not TxnDate (an invoice is often dated
// weeks before it's sent).

// The date an invoice was actually sent to the client ('YYYY-MM-DD'), or null if
// it hasn't been sent (created/draft only).
export function invoiceSendDate(inv) {
  const dt = inv?.DeliveryInfo?.DeliveryTime;
  return dt ? String(dt).slice(0, 10) : null;
}

// Sum invoices *sent* within [start, end] (inclusive 'YYYY-MM-DD'), by send date.
// Returns { income, paid, open, count } — income is the full billed amount (paid +
// still-open), matching how the firm tallies a quarter.
export function sumSentInPeriod(invoices = [], start, end) {
  let income = 0, paid = 0, open = 0, count = 0;
  for (const inv of invoices || []) {
    const sd = invoiceSendDate(inv);
    if (!sd || sd < start || sd > end) continue;
    const amt = Number(inv.TotalAmt || 0);
    const bal = Number(inv.Balance || 0);
    income += amt;
    open += bal;
    paid += amt - bal;
    count += 1;
  }
  return { income: round2(income), paid: round2(paid), open: round2(open), count };
}

// The firm only began emailing invoices through QuickBooks in late 2025, so earlier
// invoices carry no send-timestamp. In "Sent" mode a historical quarter where fewer
// than this fraction of its invoices have a send date is hidden — otherwise its
// income collapses to near-zero and the chart shows a misleading loss.
export const SENT_QUARTER_MIN_COVERAGE = 0.3;

// Fraction of a quarter's invoices (by TxnDate) that carry a real send date — our
// proxy for "was QuickBooks send-tracking in use this quarter?"
export function quarterSendCoverage(invoices = [], start, end) {
  let inQuarter = 0, withSendDate = 0;
  for (const inv of invoices || []) {
    if (inv.TxnDate < start || inv.TxnDate > (end || start)) continue;
    inQuarter += 1;
    if (invoiceSendDate(inv)) withSendDate += 1;
  }
  return inQuarter === 0 ? 0 : withSendDate / inQuarter;
}

// Period P&L on the "sent" basis: sent-invoice income overlaid on the accrual
// report's expenses (so Income − Expenses = Net stays consistent for the UI).
// `sent` carries the billed vs collected split ({ income, paid, open, count }).
export function buildSentPnl(accrualReport, invoices = [], start, end) {
  const acc = parseProfitAndLoss(accrualReport);
  const expenses = round2(acc.income - acc.netIncome);
  const s = sumSentInPeriod(invoices, start, end);
  return {
    income: s.income,
    netIncome: round2(s.income - expenses),
    expenseAccounts: acc.expenseAccounts,
    sent: s,
  };
}

// Quarter columns on the "sent" basis: each quarter's income re-dated by real send
// date, net recomputed against the accrual quarter's expenses. Historical quarters
// below `minCoverage` send-date coverage are dropped (the current, still-partial
// quarter is always kept). Returns { quarters, hidden } — hidden = how many were
// dropped, so the UI can say "N earlier quarters hidden".
export function buildSentQuarters(quarterReport, invoices = [], today, { minCoverage = SENT_QUARTER_MIN_COVERAGE } = {}) {
  const quarters = [];
  let hidden = 0;
  for (const q of parseProfitAndLossColumns(quarterReport)) {
    const partial = !!q.end && q.end > today;
    if (!partial && quarterSendCoverage(invoices, q.start, q.end) < minCoverage) {
      hidden += 1;
      continue;
    }
    const income = sumSentInPeriod(invoices, q.start, q.end).income;
    const expenses = round2(q.income - q.netIncome);
    quarters.push({ start: q.start, end: q.end, label: q.label, income, netIncome: round2(income - expenses), partial });
  }
  return { quarters, hidden };
}

// Map raw QBO invoices to a compact "top invoices" display shape, ranked by
// original amount (TotalAmt) descending. Used for the P&L section's "Top invoices"
// widget — the biggest billings in the selected period. `paid` = fully settled
// (open Balance is zero). By the invariant, the customer name is the Job ID.
export function toTopInvoices(rawInvoices = [], limit = 8) {
  return (rawInvoices || [])
    .map((inv) => ({
      id: inv.Id != null ? String(inv.Id) : null,
      docNumber: inv.DocNumber || null,
      jobId: inv.CustomerRef?.name || inv.CustomerRef?.value || '—',
      date: inv.TxnDate || null,
      amount: round2(Number(inv.TotalAmt || 0)),
      paid: Number(inv.Balance || 0) <= 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function parseProfitAndLoss(report) {
  const header = report?.Header || {};
  const topRows = report?.Rows?.Row || [];

  const sectionTotal = {}; // group -> total from its Summary row
  const incomeAccounts = [];
  const expenseAccounts = [];

  for (const section of topRows) {
    const group = section.group;
    if (group && section.Summary?.ColData) {
      sectionTotal[group] = round2(lastColValue(section.Summary.ColData));
    }
    if (group === 'Income') collectLeafRows(section.Rows, incomeAccounts);
    if (group === 'Expenses') collectLeafRows(section.Rows, expenseAccounts);
  }

  const income = sectionTotal.Income || 0;
  const cogs = sectionTotal.COGS || 0;
  const expense = sectionTotal.Expenses || 0;
  // Prefer QBO's own NetIncome; fall back to a plain income − cogs − expense.
  const netIncome = sectionTotal.NetIncome != null
    ? sectionTotal.NetIncome
    : round2(income - cogs - expense);

  const sortDesc = (a, b) => b.amount - a.amount;
  return {
    currency: header.Currency || 'USD',
    start: header.StartPeriod || null,
    end: header.EndPeriod || null,
    income,
    cogs,
    expense,
    grossProfit: sectionTotal.GrossProfit != null ? sectionTotal.GrossProfit : round2(income - cogs),
    netIncome,
    incomeAccounts: incomeAccounts.sort(sortDesc),
    expenseAccounts: expenseAccounts.sort(sortDesc),
  };
}
