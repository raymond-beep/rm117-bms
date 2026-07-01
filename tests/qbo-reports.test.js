// Pure transforms behind the Financial tab: A/R aging from open invoices and the
// P&L report parse. No network — fixtures mirror the real QBO API shapes.
import { describe, it, expect } from 'vitest';
import {
  AGING_BUCKETS,
  jobIdYear,
  normalizeInvoice,
  summarizeReceivables,
  parseProfitAndLoss,
  parseProfitAndLossColumns,
  quarterLabel,
  toTopInvoices,
} from '../api/_lib/qbo-reports.js';

// Fixed "today" so days-past-due is deterministic.
const ASOF = new Date(2026, 6, 1); // 2026-07-01 local

// Minimal raw QBO Invoice (query result) — only the fields we read.
const inv = (over) => ({
  Id: '1001',
  DocNumber: '1042',
  TxnDate: '2026-05-01',
  DueDate: '2026-06-01',
  TotalAmt: 18000,
  Balance: 18000,
  CustomerRef: { value: '58', name: '24_051_Kuhn' },
  ...over,
});

describe('normalizeInvoice', () => {
  it('flattens to the UI shape and computes days past due', () => {
    const n = normalizeInvoice(inv(), ASOF);
    expect(n.docNumber).toBe('1042');
    expect(n.customer).toBe('24_051_Kuhn');
    expect(n.jobId).toBe('24_051_Kuhn'); // DisplayName === Job ID invariant
    expect(n.amount).toBe(18000); // open Balance, not TotalAmt
    expect(n.daysPastDue).toBe(30); // Jun 1 → Jul 1
    expect(n.bucket).toBe('d1_30');
  });

  it('uses the open Balance, not the original total', () => {
    const n = normalizeInvoice(inv({ TotalAmt: 18000, Balance: 5000 }), ASOF);
    expect(n.amount).toBe(5000);
    expect(n.total).toBe(18000);
  });

  it('a not-yet-due invoice is Current (negative days)', () => {
    const n = normalizeInvoice(inv({ DueDate: '2026-08-01' }), ASOF);
    expect(n.daysPastDue).toBeLessThan(0);
    expect(n.bucket).toBe('current');
  });

  it('falls back to TxnDate when DueDate is missing', () => {
    const n = normalizeInvoice(inv({ DueDate: null, TxnDate: '2026-01-01' }), ASOF);
    expect(n.dueDate).toBe('2026-01-01');
    expect(n.bucket).toBe('d90_plus');
  });

  it('does not shift the day across a timezone (bare date is local)', () => {
    const n = normalizeInvoice(inv({ DueDate: '2026-07-01' }), ASOF);
    expect(n.daysPastDue).toBe(0); // due today, not -1 or +1
    expect(n.bucket).toBe('current');
  });
});

describe('summarizeReceivables', () => {
  const invoices = [
    inv({ Id: '1', DueDate: '2026-07-15', Balance: 92000 }),  // future → current
    inv({ Id: '2', DueDate: '2026-06-20', Balance: 46500 }),  // 11 days → 1-30
    inv({ Id: '3', DueDate: '2026-05-15', Balance: 28750 }),  // 47 days → 31-60
    inv({ Id: '4', DueDate: '2026-04-15', Balance: 12000 }),  // 77 days → 61-90
    inv({ Id: '5', DueDate: '2026-01-01', Balance: 5000 }),   // 181 days → 90+
  ];

  it('totals open balances and buckets them', () => {
    const r = summarizeReceivables(invoices, ASOF);
    expect(r.total).toBe(184250);
    const byKey = Object.fromEntries(r.buckets.map((b) => [b.key, b.amount]));
    expect(byKey.current).toBe(92000);
    expect(byKey.d1_30).toBe(46500);
    expect(byKey.d31_60).toBe(28750);
    expect(byKey.d61_90).toBe(12000);
    expect(byKey.d90_plus).toBe(5000);
  });

  it('returns all buckets in display order even when empty', () => {
    const r = summarizeReceivables([inv({ DueDate: '2026-07-15', Balance: 100 })], ASOF);
    expect(r.buckets.map((b) => b.key)).toEqual(AGING_BUCKETS.map((b) => b.key));
    expect(r.buckets.find((b) => b.key === 'd90_plus').count).toBe(0);
  });

  it('drops fully-paid invoices (Balance 0) and sorts most-overdue first', () => {
    const r = summarizeReceivables(
      [inv({ Id: 'paid', Balance: 0 }), ...invoices],
      ASOF,
    );
    expect(r.invoices).toHaveLength(5); // the Balance:0 one is excluded
    expect(r.invoices[0].id).toBe('5'); // oldest / most overdue leads
    expect(r.invoices[0].daysPastDue).toBeGreaterThan(r.invoices[1].daysPastDue);
  });

  it('handles an empty book', () => {
    const r = summarizeReceivables([], ASOF);
    expect(r.total).toBe(0);
    expect(r.invoices).toEqual([]);
    expect(r.buckets).toHaveLength(5);
    expect(r.hidden).toEqual({ count: 0, amount: 0 });
  });
});

describe('jobIdYear', () => {
  it('reads the two-digit year prefix of a Job ID', () => {
    expect(jobIdYear('25_054_McCalla')).toBe(25);
    expect(jobIdYear('24_008_Dunn_Fritchey')).toBe(24);
    expect(jobIdYear('26_042_Gonzalez')).toBe(26);
    expect(jobIdYear('23_047_FF_Jones')).toBe(23);
  });
  it('returns null for a non-Job-ID customer name', () => {
    expect(jobIdYear('Chalimar Frees')).toBeNull();
    expect(jobIdYear('')).toBeNull();
    expect(jobIdYear(null)).toBeNull();
  });
});

describe('summarizeReceivables — minJobYear filter (Financial tab "recent" view)', () => {
  const book = [
    inv({ Id: 'a', CustomerRef: { name: '26_042_Gonzalez' }, DueDate: '2026-06-20', Balance: 10000 }),
    inv({ Id: 'b', CustomerRef: { name: '25_002_Odunlami' }, DueDate: '2026-06-20', Balance: 20000 }),
    inv({ Id: 'c', CustomerRef: { name: '24_062_FF_Jaipersaud' }, DueDate: '2024-07-11', Balance: 2000 }),
    inv({ Id: 'd', CustomerRef: { name: '23_047_FF_Jones' }, DueDate: '2024-01-11', Balance: 1500 }),
    inv({ Id: 'e', CustomerRef: { name: 'Chalimar Frees' }, DueDate: '2025-06-03', Balance: 2500 }),
  ];

  it('no filter (minJobYear null) shows the whole book', () => {
    const r = summarizeReceivables(book, ASOF);
    expect(r.invoices).toHaveLength(5);
    expect(r.total).toBe(36000);
    expect(r.hidden).toEqual({ count: 0, amount: 0 });
  });

  it('minJobYear 25 keeps 25/26 jobs and hides 24-and-older + non-Job-ID names', () => {
    const r = summarizeReceivables(book, ASOF, { minJobYear: 25 });
    expect(r.invoices.map((i) => i.jobId).sort()).toEqual(['25_002_Odunlami', '26_042_Gonzalez']);
    expect(r.total).toBe(30000); // 10k + 20k only
    // hidden: 24_, 23_, and the non-Job-ID 'Chalimar Frees' → 3 invoices, $6,000
    expect(r.hidden).toEqual({ count: 3, amount: 6000 });
  });

  it('buckets reflect only the shown invoices', () => {
    const r = summarizeReceivables(book, ASOF, { minJobYear: 25 });
    const total = r.buckets.reduce((s, b) => s + b.amount, 0);
    expect(total).toBe(30000);
  });
});

// A trimmed but structurally faithful ProfitAndLoss report (accrual, YTD).
const pnlReport = {
  Header: { Currency: 'USD', StartPeriod: '2026-01-01', EndPeriod: '2026-07-01', ReportName: 'ProfitAndLoss' },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: 'Income' }, { value: '' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Design Fees', id: '80' }, { value: '402000.00' }] },
            { type: 'Data', ColData: [{ value: 'CD Phase', id: '81' }, { value: '128400.00' }] },
            { type: 'Data', ColData: [{ value: 'Retainers', id: '82' }, { value: '82000.00' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '612400.00' }] },
        type: 'Section',
        group: 'Income',
      },
      {
        Summary: { ColData: [{ value: 'Gross Profit' }, { value: '612400.00' }] },
        type: 'Section',
        group: 'GrossProfit',
      },
      {
        Header: { ColData: [{ value: 'Expenses' }, { value: '' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Payroll', id: '90' }, { value: '310000.00' }] },
            { type: 'Data', ColData: [{ value: 'Rent', id: '91' }, { value: '48000.00' }] },
            { type: 'Data', ColData: [{ value: 'Software', id: '92' }, { value: '80900.00' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '438900.00' }] },
        type: 'Section',
        group: 'Expenses',
      },
      {
        Summary: { ColData: [{ value: 'Net Operating Income' }, { value: '173500.00' }] },
        type: 'Section',
        group: 'NetOperatingIncome',
      },
      {
        Summary: { ColData: [{ value: 'Net Income' }, { value: '173500.00' }] },
        type: 'Section',
        group: 'NetIncome',
      },
    ],
  },
};

describe('parseProfitAndLoss', () => {
  it('pulls section totals and net income', () => {
    const p = parseProfitAndLoss(pnlReport);
    expect(p.income).toBe(612400);
    expect(p.expense).toBe(438900);
    expect(p.netIncome).toBe(173500);
    expect(p.currency).toBe('USD');
    expect(p.start).toBe('2026-01-01');
    expect(p.end).toBe('2026-07-01');
  });

  it('collects and sorts leaf income/expense accounts by amount desc', () => {
    const p = parseProfitAndLoss(pnlReport);
    expect(p.incomeAccounts.map((a) => a.label)).toEqual(['Design Fees', 'CD Phase', 'Retainers']);
    expect(p.incomeAccounts[0].amount).toBe(402000);
    expect(p.expenseAccounts[0]).toEqual({ label: 'Payroll', amount: 310000 });
  });

  it('falls back to income − cogs − expense when no NetIncome section', () => {
    const noNet = { ...pnlReport, Rows: { Row: pnlReport.Rows.Row.filter((r) => r.group !== 'NetIncome') } };
    const p = parseProfitAndLoss(noNet);
    expect(p.netIncome).toBe(173500); // 612400 − 0 − 438900
  });

  it('does not throw on an empty/garbage report', () => {
    expect(parseProfitAndLoss({})).toMatchObject({ income: 0, expense: 0, netIncome: 0 });
    expect(parseProfitAndLoss(null)).toMatchObject({ income: 0, expense: 0 });
  });
});

describe('quarterLabel', () => {
  it('maps a quarter start date to a Q# YYYY label', () => {
    expect(quarterLabel('2025-01-01')).toBe('Q1 2025');
    expect(quarterLabel('2025-04-01')).toBe('Q2 2025');
    expect(quarterLabel('2026-07-01')).toBe('Q3 2026');
    expect(quarterLabel('2026-10-15')).toBe('Q4 2026');
  });
  it('returns empty on junk', () => {
    expect(quarterLabel('')).toBe('');
    expect(quarterLabel(null)).toBe('');
  });
});

// Structurally faithful to the real quarter-summarized report shape (probed live):
// column 0 = Account label, then one Money column per quarter carrying
// MetaData StartDate/EndDate, then a grand "Total" column with no StartDate.
const qtrReport = {
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      { ColTitle: 'Jan - Mar, 2025', ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: '2025-01-01' }, { Name: 'EndDate', Value: '2025-03-31' }] },
      { ColTitle: 'Apr - Jun, 2025', ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: '2025-04-01' }, { Name: 'EndDate', Value: '2025-06-30' }] },
      { ColTitle: 'Total', ColType: 'Money', MetaData: [] },
    ],
  },
  Rows: {
    Row: [
      { group: 'Income', Summary: { ColData: [{ value: 'Total Income' }, { value: '60400.00' }, { value: '162133.74' }, { value: '222533.74' }] } },
      { group: 'COGS', Summary: { ColData: [{ value: 'Total COGS' }, { value: '12858.27' }, { value: '14713.35' }, { value: '27571.62' }] } },
      { group: 'Expenses', Summary: { ColData: [{ value: 'Total Expenses' }, { value: '43685.12' }, { value: '44582.34' }, { value: '88267.46' }] } },
      { group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '3856.61' }, { value: '102838.05' }, { value: '106694.66' }] } },
    ],
  },
};

describe('parseProfitAndLossColumns', () => {
  it('returns one row per quarter column, skipping the grand Total column', () => {
    const rows = parseProfitAndLossColumns(qtrReport);
    expect(rows).toHaveLength(2); // two quarters, not the Total column
    expect(rows.map((r) => r.label)).toEqual(['Q1 2025', 'Q2 2025']);
  });

  it('reads income / expense / net per column (index-aligned to Summary.ColData)', () => {
    const [q1, q2] = parseProfitAndLossColumns(qtrReport);
    expect(q1).toMatchObject({ income: 60400, expense: 43685.12, netIncome: 3856.61, start: '2025-01-01', end: '2025-03-31' });
    expect(q2).toMatchObject({ income: 162133.74, expense: 44582.34, netIncome: 102838.05 });
  });

  it('carries a negative net income through (a bad quarter)', () => {
    const bad = JSON.parse(JSON.stringify(qtrReport));
    bad.Rows.Row.find((r) => r.group === 'NetIncome').Summary.ColData[1].value = '-3130.29';
    expect(parseProfitAndLossColumns(bad)[0].netIncome).toBe(-3130.29);
  });

  it('does not throw on an empty report', () => {
    expect(parseProfitAndLossColumns({})).toEqual([]);
    expect(parseProfitAndLossColumns(null)).toEqual([]);
  });
});

describe('toTopInvoices', () => {
  const raw = [
    { Id: '1', DocNumber: '1071', CustomerRef: { name: '25_044_FF_Luebenow-Suchy' }, TxnDate: '2026-02-01', TotalAmt: 12400, Balance: 12400 },
    { Id: '2', DocNumber: '1076', CustomerRef: { name: '25_047_Costello' }, TxnDate: '2026-03-01', TotalAmt: 10500, Balance: 0 },
    { Id: '3', DocNumber: '1064', CustomerRef: { name: '25_037_Smith' }, TxnDate: '2026-01-15', TotalAmt: 8800, Balance: 8800 },
  ];
  it('ranks by TotalAmt desc and flags paid (zero balance)', () => {
    const top = toTopInvoices(raw, 2);
    expect(top).toHaveLength(2);
    expect(top[0]).toMatchObject({ jobId: '25_044_FF_Luebenow-Suchy', amount: 12400, paid: false });
    expect(top[1]).toMatchObject({ jobId: '25_047_Costello', amount: 10500, paid: true });
  });
  it('handles an empty list', () => {
    expect(toTopInvoices([])).toEqual([]);
  });
});
