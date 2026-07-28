// Demo fixtures for the screens backed by outside services — QuickBooks, Gmail,
// Google Calendar, Google Drive, and the Anthropic-powered checkset review.
//
// In the demo build none of those services are connected (no keys ship with it),
// so these canned payloads stand in. They are shaped exactly like the real
// responses, so the same components render them unmodified. Every figure is
// invented; the totals are internally consistent so the tiles, chart and tables
// agree with each other the way real data would.

import { PAYMENTS } from './jobs.js';

// ---------------------------------------------------------------- QuickBooks

// Open invoices behind the A/R aging table. Job IDs match the jobs fixture,
// upholding the real invariant: QBO Customer DisplayName === Job ID.
const OPEN_INVOICES = [
  { id: '2041', docNumber: '1041', customer: '26_041_Whitaker', jobId: '26_041_Whitaker', description: 'Design Phase I', txnDate: '2026-07-14', dueDate: '2026-07-14', total: 4800, amount: 4800, daysPastDue: 14, bucket: 'd1_30' },
  { id: '2029', docNumber: '1031', customer: '26_029_Varga', jobId: '26_029_Varga', description: 'Design Phase II', txnDate: '2026-07-06', dueDate: '2026-07-06', total: 7700, amount: 7700, daysPastDue: 22, bucket: 'd1_30' },
  { id: '2014', docNumber: '1016', customer: '26_014_Bramble', jobId: '26_014_Bramble', description: 'Construction Documents', txnDate: '2026-06-12', dueDate: '2026-06-12', total: 6700, amount: 6700, daysPastDue: 46, bucket: 'd31_60' },
  { id: '2061', docNumber: '0963', customer: '25_061_Delacroix', jobId: '25_061_Delacroix', description: 'Construction Documents', txnDate: '2026-05-20', dueDate: '2026-05-20', total: 8200, amount: 8200, daysPastDue: 69, bucket: 'd61_90' },
  { id: '2022', docNumber: '1023', customer: '26_022_FF_Rosewood', jobId: '26_022_FF_Rosewood', description: 'Design Phase I — balance', txnDate: '2026-06-30', dueDate: '2026-06-30', total: 12000, amount: 12000, daysPastDue: 28, bucket: 'd1_30' },
  { id: '2033', docNumber: '0935', customer: '25_033_Rosewood_Court', jobId: '25_033_Rosewood_Court', description: 'Construction Administration', txnDate: '2026-04-02', dueDate: '2026-04-02', total: 5800, amount: 5800, daysPastDue: 117, bucket: 'd90_plus' },
  { id: '2038', docNumber: '1039', customer: '26_038_Okonkwo', jobId: '26_038_Okonkwo', description: 'Zoning analysis', txnDate: '2026-08-05', dueDate: '2026-08-05', total: 3360, amount: 3360, daysPastDue: -8, bucket: 'current' },
];

const BUCKET_ORDER = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90_plus', label: '90+ days' },
];

function buildReceivables() {
  const buckets = BUCKET_ORDER.map(({ key, label }) => {
    const rows = OPEN_INVOICES.filter((i) => i.bucket === key);
    return { key, label, amount: rows.reduce((s, i) => s + i.amount, 0), count: rows.length };
  });
  return {
    total: OPEN_INVOICES.reduce((s, i) => s + i.amount, 0),
    buckets,
    invoices: [...OPEN_INVOICES].sort((a, b) => b.daysPastDue - a.daysPastDue || b.amount - a.amount),
    hidden: { count: 3, amount: 4150 }, // pre-2025 invoices the "2025+" scope filters out
  };
}

// Expense accounts — the same handful an architecture practice actually carries.
const EXPENSE_ACCOUNTS = [
  { name: 'Subconsultants — Structural', amount: 18400 },
  { name: 'Payroll', amount: 96500 },
  { name: 'Rent', amount: 21000 },
  { name: 'Software & Subscriptions', amount: 7350 },
  { name: 'Professional Insurance', amount: 6800 },
  { name: 'Filing & Permit Fees', amount: 4120 },
  { name: 'Printing & Reprographics', amount: 2940 },
  { name: 'Vehicle & Travel', amount: 2310 },
];
const EXPENSE_TOTAL = EXPENSE_ACCOUNTS.reduce((s, a) => s + a.amount, 0);

// Invoices sent, per quarter. Keeping the invoice list as the SOURCE and deriving
// every total from it is what stops the Financial tab contradicting itself: the
// tiles, the chart bars and the invoice table below them are then guaranteed to
// add up, whichever period the user picks.
const QUARTER_INVOICES = {
  '2025 Q2': [
    { id: '1901', jobId: '25_033_Rosewood_Court', docNumber: '0933', description: 'Retainer', sentDate: '2025-06-24', amount: 29000, balance: 0, paid: true },
    { id: '1902', jobId: '25_012_Hollis', docNumber: '0912', description: 'Construction Documents', sentDate: '2025-05-19', amount: 24800, balance: 0, paid: true },
    { id: '1903', jobId: '24_088_Marchetti', docNumber: '0888', description: 'Construction Administration', sentDate: '2025-04-30', amount: 18400, balance: 0, paid: true },
    { id: '1904', jobId: '25_007_Bellweather', docNumber: '0907', description: 'Design Phase II', sentDate: '2025-06-11', amount: 12000, balance: 0, paid: true },
  ],
  '2025 Q3': [
    { id: '1911', jobId: '25_044_Bramble_Roof', docNumber: '0944', description: 'Retainer', sentDate: '2025-09-05', amount: 5700, balance: 0, paid: true },
    { id: '1912', jobId: '25_033_Rosewood_Court', docNumber: '0936', description: 'Design Phase III', sentDate: '2025-08-14', amount: 34600, balance: 0, paid: true },
    { id: '1913', jobId: '25_048_FE_Kestrel', docNumber: '0946', description: 'Fire escape — survey & design', sentDate: '2025-09-22', amount: 28900, balance: 4300, paid: false },
    { id: '1914', jobId: '25_012_Hollis', docNumber: '0913', description: 'Permitting', sentDate: '2025-07-30', amount: 26100, balance: 0, paid: true },
    { id: '1915', jobId: '25_007_Bellweather', docNumber: '0908', description: 'Construction Documents', sentDate: '2025-08-28', amount: 20300, balance: 0, paid: true },
  ],
  '2025 Q4': [
    { id: '1921', jobId: '24_018_FF_Delacroix', docNumber: '0818', description: 'Final — closeout', sentDate: '2025-11-11', amount: 35000, balance: 0, paid: true },
    { id: '1922', jobId: '25_061_Delacroix', docNumber: '0961', description: 'Retainer', sentDate: '2025-11-28', amount: 12300, balance: 0, paid: true },
    { id: '1923', jobId: '24_052_Okonkwo_Deck', docNumber: '0852', description: 'Final', sentDate: '2025-12-04', amount: 7400, balance: 0, paid: true },
    { id: '1924', jobId: '25_007_Bellweather', docNumber: '0909', description: 'Construction Administration', sentDate: '2025-10-17', amount: 24800, balance: 3700, paid: false },
    { id: '1925', jobId: '25_012_Hollis', docNumber: '0914', description: 'Final', sentDate: '2025-12-19', amount: 18300, balance: 0, paid: true },
  ],
  '2026 Q1': [
    { id: '2001', jobId: '26_007_Harborline', docNumber: '1007', description: 'Retainer', sentDate: '2026-02-13', amount: 21600, balance: 0, paid: true },
    { id: '2002', jobId: '24_071_Varga_Rental', docNumber: '0871', description: 'Final', sentDate: '2026-01-30', amount: 26500, balance: 0, paid: true },
    { id: '2003', jobId: '26_019_Harborline_Annex', docNumber: '1019', description: 'Retainer', sentDate: '2026-03-16', amount: 8800, balance: 0, paid: true },
    { id: '2004', jobId: '26_014_Bramble', docNumber: '1014', description: 'Retainer', sentDate: '2026-03-02', amount: 10050, balance: 0, paid: true },
    { id: '2005', jobId: '25_061_Delacroix', docNumber: '0962', description: 'Design Phase I', sentDate: '2026-03-11', amount: 16400, balance: 0, paid: true },
    { id: '2006', jobId: '25_033_Rosewood_Court', docNumber: '0934', description: 'Construction Documents', sentDate: '2026-02-24', amount: 23200, balance: 0, paid: true },
    { id: '2007', jobId: '25_055_Whitaker_Garage', docNumber: '0955', description: 'Final', sentDate: '2026-03-28', amount: 8900, balance: 1750, paid: false },
  ],
  '2026 Q2': [
    { id: '2011', jobId: '26_022_FF_Rosewood', docNumber: '1022', description: 'Retainer', sentDate: '2026-05-08', amount: 24000, balance: 0, paid: true },
    { id: '2012', jobId: '26_007_Harborline', docNumber: '1008', description: 'Design Phase I', sentDate: '2026-04-28', amount: 21600, balance: 0, paid: true },
    { id: '2013', jobId: '26_029_Varga', docNumber: '1029', description: 'Retainer', sentDate: '2026-05-22', amount: 7700, balance: 0, paid: true },
    { id: '2014', jobId: '26_029_Varga', docNumber: '1030', description: 'Design Phase I', sentDate: '2026-06-30', amount: 7700, balance: 0, paid: true },
    { id: '2015', jobId: '26_035_Raghunathan', docNumber: '1035', description: 'Retainer', sentDate: '2026-05-12', amount: 8850, balance: 0, paid: true },
    { id: '2016', jobId: '26_035_Raghunathan', docNumber: '1036', description: 'Design Phase I', sentDate: '2026-06-18', amount: 5900, balance: 0, paid: true },
    { id: '2017', jobId: '26_014_Bramble', docNumber: '1015', description: 'Design Phase I', sentDate: '2026-06-09', amount: 10050, balance: 0, paid: true },
    { id: '2018', jobId: '25_033_Rosewood_Court', docNumber: '0935', description: 'Construction Administration', sentDate: '2026-04-02', amount: 5800, balance: 5800, paid: false },
    { id: '2019', jobId: '25_061_Delacroix', docNumber: '0963', description: 'Construction Documents', sentDate: '2026-05-20', amount: 8200, balance: 8200, paid: false },
    { id: '2020', jobId: '26_014_Bramble', docNumber: '1016', description: 'Construction Documents', sentDate: '2026-06-12', amount: 6700, balance: 6700, paid: false },
  ],
  '2026 Q3': [
    { id: '2022', jobId: '26_022_FF_Rosewood', docNumber: '1023', description: 'Design Phase I — balance', sentDate: '2026-07-03', amount: 12000, balance: 12000, paid: false },
    { id: '2029', jobId: '26_029_Varga', docNumber: '1031', description: 'Design Phase II', sentDate: '2026-07-06', amount: 7700, balance: 7700, paid: false },
    { id: '2041', jobId: '26_041_Whitaker', docNumber: '1041', description: 'Design Phase I', sentDate: '2026-07-14', amount: 4800, balance: 4800, paid: false },
    { id: '2038', jobId: '26_038_Okonkwo', docNumber: '1039', description: 'Zoning analysis', sentDate: '2026-07-24', amount: 3360, balance: 3360, paid: false },
    { id: '2009', jobId: '26_007_Harborline', docNumber: '1009', description: 'Construction Documents', sentDate: '2026-07-02', amount: 14400, balance: 0, paid: true },
    { id: '2037', jobId: '26_035_Raghunathan', docNumber: '1037', description: 'Design Phase II', sentDate: '2026-07-09', amount: 5900, balance: 0, paid: true },
    { id: '1948', jobId: '25_048_FE_Kestrel', docNumber: '0948', description: 'Fire escape — filing set', sentDate: '2026-07-01', amount: 12500, balance: 0, paid: true },
  ],
};

// Quarter definitions. `expense` is the quarter's real cost base; net income is
// always income − expense, so a period's net is the sum of its quarters' nets.
// 2026 Q3 is still in progress (fewer weeks, so lower expenses) — the UI dims it.
const QUARTER_DEFS = [
  { start: '2025-04-01', end: '2025-06-30', label: '2025 Q2', expense: 71800 },
  { start: '2025-07-01', end: '2025-09-30', label: '2025 Q3', expense: 86700 },
  { start: '2025-10-01', end: '2025-12-31', label: '2025 Q4', expense: 78200 },
  { start: '2026-01-01', end: '2026-03-31', label: '2026 Q1', expense: 83700 },
  { start: '2026-04-01', end: '2026-06-30', label: '2026 Q2', expense: 90700 },
  { start: '2026-07-01', end: '2026-09-30', label: '2026 Q3', expense: 41000, partial: true, current: true },
];

const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);

const QUARTERS = QUARTER_DEFS.map((q) => {
  const inv = QUARTER_INVOICES[q.label] || [];
  const income = sum(inv, (i) => i.amount);
  const paid = income - sum(inv, (i) => i.balance);
  return { ...q, income, paid, netIncome: income - q.expense };
});

export function financials({ basis = 'sent', start = '2026-07-01', end = '2026-09-30' } = {}) {
  // Answer for the period actually asked for. The Financial tab defaults to
  // year-to-date but lets you jump to a quarter or a month, and a fixture that
  // returned one quarter's figures no matter what would show a year of expenses
  // against a quarter of income — i.e. a firm apparently losing money.
  const inRange = (d) => d >= start && d <= end;
  const quarters = QUARTERS.filter((q) => q.start <= end && q.end >= start);

  const invoices = Object.entries(QUARTER_INVOICES)
    .flatMap(([, rows]) => rows)
    .filter((i) => inRange(i.sentDate))
    .sort((a, b) => (b.balance - a.balance) || (b.amount - a.amount));

  const billed = sum(invoices, (i) => i.amount);
  const open = sum(invoices, (i) => i.balance);
  const paid = billed - open;

  // Expenses accrue over time, so prorate the overlapping quarters by how much of
  // each actually falls inside the requested window.
  const days = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 86400000 + 1);
  const expense = Math.round(quarters.reduce((s, q) => {
    const from = q.start > start ? q.start : start;
    const to = q.end < end ? q.end : end;
    return s + q.expense * (days(from, to) / days(q.start, q.end));
  }, 0));

  // The three bases are genuinely different numbers in the real app — that is the
  // whole reason the toggle exists — so the demo differentiates them too:
  // sent = billed for completed work · cash = actually collected ·
  // all invoiced = every invoice raised, including phases not yet sent.
  const income = basis === 'cash' ? paid : basis === 'accrual' ? Math.round(billed * 1.34) : billed;
  const scale = expense ? expense / EXPENSE_TOTAL : 0;

  const pnl = {
    currency: 'USD',
    start,
    end,
    income,
    cogs: 0,
    expense,
    grossProfit: income,
    netIncome: income - expense,
    incomeAccounts: [
      { name: 'Architectural Services', amount: Math.round(income * 0.86) },
      { name: 'Zoning & Filing Services', amount: income - Math.round(income * 0.86) },
    ],
    expenseAccounts: EXPENSE_ACCOUNTS
      .map((a) => ({ ...a, amount: Math.round(a.amount * scale) }))
      .filter((a) => a.amount > 0),
    ...(basis === 'sent' ? { sent: { income: billed, paid, open, count: invoices.length } } : {}),
  };

  const topInvoices = [...invoices]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map((i) => ({ id: i.id, docNumber: i.docNumber, jobId: i.jobId, date: i.sentDate, amount: i.amount, paid: i.paid }));

  return {
    configured: true,
    demo: true,
    asOf: '2026-07-28T15:20:00Z',
    period: { start, end },
    basis,
    arScope: 'recent',
    pnl,
    pnlQuarters: QUARTERS,
    topInvoices,
    periodInvoices: basis === 'sent' ? invoices : null,
    receivables: buildReceivables(),
  };
}

export const QBO_STATUS = { configured: true, env: 'demo', realm: 'demo-realm', demo: true };

// -------------------------------------------------------------- Gmail inbox

export const INBOX = {
  connected: true,
  demo: true,
  count: 6,
  messages: [
    { id: 'm-1', from: 'Alicia Brenner', email: 'a.brenner@rosewooddev.example.com', subject: 'Halsey St — massing options', date: '2026-07-27T16:42:00Z', snippet: 'These look great. Dev has one question about the setback on the north elevation — can we walk through it Tuesday?', isClient: true, clientLabel: 'Rosewood Development Group', jobs: ['26_022_FF_Rosewood'] },
    { id: 'm-2', from: 'Elena Varga', email: 'the.vargas@example.com', subject: 'Re: DPII drawings for review', date: '2026-07-27T13:05:00Z', snippet: 'We love the plan overall. The only thing we keep going back and forth on is the stair location…', isClient: true, clientLabel: 'Tomas & Elena Varga', jobs: ['26_029_Varga'] },
    { id: 'm-3', from: 'Montclair Building Dept.', email: 'permits@montclairnj.example.gov', subject: 'Plan review comments — 88 Bloomfield Ave', date: '2026-07-26T09:18:00Z', snippet: 'Please find attached the plan review comments for permit application 26-1184. Response required within 30 days.', isClient: false, clientLabel: null, jobs: ['25_048_FE_Kestrel'] },
    { id: 'm-4', from: 'Grant Feld', email: 'g.feld@rosewooddev.example.com', subject: 'Pricing set — questions', date: '2026-07-25T18:30:00Z', snippet: 'Got the CDs. Two RFIs before we price it: the window schedule references a type W-7 that I do not see on A-401…', isClient: true, clientLabel: 'Rosewood Development Group', jobs: ['26_007_Harborline'] },
    { id: 'm-5', from: 'Priya Raghunathan', email: 'priya.r@example.com', subject: 'Finish schedule — final', date: '2026-07-27T11:47:00Z', snippet: 'Confirming the tile selection for the primary bath. Attaching the spec sheet from the showroom.', isClient: true, clientLabel: 'Priya Raghunathan', jobs: ['26_035_Raghunathan'] },
    { id: 'm-6', from: 'Halvorsen Structural', email: 'k.halvorsen@halvorsenstructural.example.com', subject: 'Re: Structural — framing plan', date: '2026-07-24T08:12:00Z', snippet: 'Apologies for the delay. Framing plan will be with you by end of week — the beam schedule is the last piece.', isClient: false, clientLabel: null, jobs: ['25_061_Delacroix'] },
  ],
};

// ----------------------------------------------------------- Google Calendar

export const CALENDAR = {
  connected: true,
  demo: true,
  count: 7,
  events: [
    { id: 'e-1', title: 'Survey — 318 GlenAyre Dr', start: '2026-07-30T13:00:00Z', end: '2026-07-30T15:00:00Z', allDay: false, location: '318 GlenAyre Dr, Scotch Plains NJ', calendar: 'Room 117 — Company' },
    { id: 'e-2', title: 'Varga DPII review call', start: '2026-07-30T18:00:00Z', end: '2026-07-30T19:00:00Z', allDay: false, location: 'Zoom', calendar: 'Room 117 — Company' },
    { id: 'e-3', title: 'Site visit #8 — 19 Court St', start: '2026-08-04T14:00:00Z', end: '2026-08-04T16:00:00Z', allDay: false, location: '19 Court St, Elizabeth NJ', calendar: 'Room 117 — Company' },
    { id: 'e-4', title: 'Bramble Court board meeting', start: '2026-08-06T23:00:00Z', end: '2026-08-07T00:30:00Z', allDay: false, location: '30 Bramble Ct, Union NJ', calendar: 'Room 117 — Company' },
    { id: 'e-5', title: 'GC pricing due — Harborline', start: '2026-08-08', end: '2026-08-08', allDay: true, location: null, calendar: 'Room 117 — Company' },
    { id: 'e-6', title: 'Kestrel fit-out kickoff (tentative)', start: '2026-08-11T15:00:00Z', end: '2026-08-11T16:00:00Z', allDay: false, location: '705 Springfield Ave, Summit NJ', calendar: 'Room 117 — Company' },
    { id: 'e-7', title: 'Whitaker — zoning pre-application', start: '2026-08-12T17:30:00Z', end: '2026-08-12T18:30:00Z', allDay: false, location: 'Scotch Plains Municipal Building', calendar: 'Room 117 — Company' },
  ],
};

// ------------------------------------------------------ Drive → app sync queue

export const DRIVE_QUEUE = {
  source: 'demo',
  demo: true,
  queue: [
    { folderId: 'demo-new-1', name: '26_046_Castellanos', jobNumber: '26_046', lastName: 'Castellanos', kind: 'job', createdTime: '2026-07-23T10:04:00Z', webViewLink: null },
    { folderId: 'demo-new-2', name: '26_xxx_Nakamura', jobNumber: null, lastName: 'Nakamura', kind: 'lead', createdTime: '2026-07-25T15:41:00Z', webViewLink: null },
    { folderId: 'demo-new-3', name: '26_047_ Trent', jobNumber: '26_047', lastName: 'Trent', kind: 'job', createdTime: '2026-07-26T09:12:00Z', webViewLink: null, warning: 'Folder name has a stray space — rename it in Drive before importing.' },
  ],
};

// ------------------------------------------------- Drawing QA (checkset review)

export const CHECKSET_FILES = {
  configured: true,
  demo: true,
  files: [
    { id: 'demo-set-1', name: '26_007_Harborline — Permit Set 07-18.pdf', modifiedTime: '2026-07-18T19:22:00Z', size: 18442133, status: 'reviewed', setId: 'set-1' },
    { id: 'demo-set-2', name: '26_014_Bramble — CD Progress 07-22.pdf', modifiedTime: '2026-07-22T14:08:00Z', size: 9120044, status: 'in_review', setId: 'set-2' },
    { id: 'demo-set-3', name: '25_061_Delacroix — Checkset 06-30.pdf', modifiedTime: '2026-06-30T11:55:00Z', size: 12880311, status: 'uploaded', setId: null },
  ],
};

// One reviewed sheet's worth of results — enough to show what the AI pass returns:
// pass / fail / review verdicts, the reason text, and a human override.
export const CHECKSET_RESULTS = {
  demo: true,
  set: { id: 'set-1', job_number: '26_007_Harborline', drive_file_id: 'demo-set-1', status: 'reviewed', page_count: 12 },
  page: 3,
  sheet_type: 'floor_plan',
  sheet_number: 'A-201',
  sheet_title: 'Second Floor Plan',
  advisory: null,
  results: [
    { id: 'GEN-01', label: 'Sheet number matches the drawing index', verdict: 'pass', reason: 'A-201 appears in the index on G-001 with a matching title.' },
    { id: 'GEN-04', label: 'Title block is complete (project, date, seal)', verdict: 'pass', reason: 'Project name, issue date 2026-07-18 and seal block all present.' },
    { id: 'PLN-02', label: 'All rooms are named and numbered', verdict: 'fail', reason: 'Two spaces on the north side are unlabeled — the closet between bedrooms 204 and 205, and the alcove off the hall.' },
    { id: 'PLN-05', label: 'Overall and string dimensions close', verdict: 'fail', reason: 'The east elevation string dimensions total 42\'-4" against an overall of 42\'-8". Four inches unaccounted for.' },
    { id: 'PLN-07', label: 'Door and window tags match the schedules', verdict: 'review', reason: 'Window type W-7 is tagged twice on this sheet but does not appear on the schedule on A-401. Confirm whether W-7 was superseded.' },
    { id: 'PLN-09', label: 'Egress paths and widths are shown', verdict: 'pass', reason: 'Both stairs dimensioned at 3\'-8" clear, exceeding the required 3\'-0".' },
    { id: 'STR-03', label: 'Structural grid aligns with the architectural plan', verdict: 'pass', reason: 'Grid lines 1–6 and A–D align with the framing plan on S-201.' },
    { id: 'CDE-02', label: 'Fire-rated assemblies are keyed to the code plan', verdict: 'review', reason: 'The demising wall between units is drawn but carries no rating tag on this sheet. It is tagged on the code plan G-002 — confirm this is intentional.' },
  ],
  overrides: { 'CDE-02': { verdict: 'pass', by: 'Ray Arocha', at: '2026-07-19T14:30:00Z', note: 'Rating is called out on G-002 per office standard — acceptable.' } },
  reviewed_ids: ['GEN-01', 'GEN-04', 'PLN-09', 'STR-03', 'CDE-02'],
};

export const CHECKSET_OVERVIEW = {
  demo: true,
  set: { id: 'set-1', job_number: '26_007_Harborline', status: 'reviewed', page_count: 12 },
  sheets: [
    { page: 1, sheet_number: 'G-001', sheet_title: 'Cover & Drawing Index', sheet_type: 'general', pass: 9, fail: 0, review: 1, actionable: 1, reviewed: 1 },
    { page: 2, sheet_number: 'G-002', sheet_title: 'Code Plan & Life Safety', sheet_type: 'code', pass: 11, fail: 1, review: 0, actionable: 1, reviewed: 1 },
    { page: 3, sheet_number: 'A-201', sheet_title: 'Second Floor Plan', sheet_type: 'floor_plan', pass: 4, fail: 2, review: 2, actionable: 4, reviewed: 4 },
    { page: 4, sheet_number: 'A-202', sheet_title: 'Third Floor Plan', sheet_type: 'floor_plan', pass: 7, fail: 1, review: 0, actionable: 1, reviewed: 0 },
    { page: 5, sheet_number: 'A-301', sheet_title: 'Exterior Elevations', sheet_type: 'elevation', pass: 8, fail: 0, review: 1, actionable: 1, reviewed: 1 },
    { page: 6, sheet_number: 'A-401', sheet_title: 'Door & Window Schedules', sheet_type: 'schedule', pass: 5, fail: 2, review: 1, actionable: 3, reviewed: 0 },
  ],
};

// ------------------------------------------------------------- Weekly planner

export const DELEGATION_MEMBERS = [
  { id: 'dm-0', name: 'Everyone', clerk_email: '__studio__', is_admin: false, active: true, sort_order: 0 },
  { id: 'dm-1', name: 'Tom', clerk_email: 'tom@rm117.com', is_admin: false, active: true, sort_order: 1 },
  { id: 'dm-2', name: 'Ray', clerk_email: 'raymond@rm117.com', is_admin: false, active: true, sort_order: 2 },
  { id: 'dm-3', name: 'Nicole', clerk_email: 'nicole@rm117.com', is_admin: false, active: true, sort_order: 3 },
  { id: 'dm-4', name: 'Ang', clerk_email: 'angelena@rm117.com', is_admin: true, active: true, sort_order: 4 },
  { id: 'dm-5', name: 'Dani', clerk_email: 'dani@rm117.com', is_admin: false, active: true, sort_order: 5 },
];

// The planner is keyed by the Monday of the week. DEMO_TODAY (2026-07-28) is a
// Tuesday, so the demo week is 2026-07-27. `day_index` is 0=Mon … 4=Fri.
export const DEMO_WEEK_KEY = '2026-07-27';

export const DELEGATION_NOTES = [
  { id: 'dn-1', week_key: DEMO_WEEK_KEY, row_owner_email: '__studio__', day_index: 1, text: 'Measure-up at 318 GlenAyre — everyone who can, 1pm', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-2', week_key: DEMO_WEEK_KEY, row_owner_email: 'tom@rm117.com', day_index: 0, text: 'Halsey St massing — finish option C', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-3', week_key: DEMO_WEEK_KEY, row_owner_email: 'tom@rm117.com', day_index: 2, text: 'Varga stair study', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-4', week_key: DEMO_WEEK_KEY, row_owner_email: 'raymond@rm117.com', day_index: 1, text: 'Harborline RFI responses (W-7 schedule)', created_by_email: 'raymond@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-5', week_key: DEMO_WEEK_KEY, row_owner_email: 'raymond@rm117.com', day_index: 3, text: 'Site visit #8 — 19 Court St', created_by_email: 'raymond@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-6', week_key: DEMO_WEEK_KEY, row_owner_email: 'nicole@rm117.com', day_index: 0, text: 'Bramble repair scope — board packet', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-7', week_key: DEMO_WEEK_KEY, row_owner_email: 'angelena@rm117.com', day_index: 4, text: 'Invoice run + chase Delacroix (69 days)', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
  { id: 'dn-8', week_key: DEMO_WEEK_KEY, row_owner_email: 'dani@rm117.com', day_index: 2, text: 'Montclair plan review comments — start responses', created_by_email: 'angelena@rm117.com', updated_at: '2026-07-27T12:00:00Z' },
];

// ------------------------------------------------ Saved documents (generators)

export const PROPOSALS = [
  { id: 'pr-1', job_id: '26_xxx_Kestrel', template_id: null, status: 'sent', docusign_envelope_id: 'demo-env-1', sent_date: '2026-07-21T15:00:00Z', signed_date: null, created_at: '2026-07-20T10:00:00Z', updated_at: '2026-07-21T15:00:00Z', content: { clientName: 'Kestrel Restaurant Group', projectAddress: '705 Springfield Ave, Summit NJ', scope: 'Restaurant fit-out, approximately 3,200 sf', designPhases: 2, fee: 47000 } },
  { id: 'pr-2', job_id: '26_xxx_Petrosian', template_id: null, status: 'sent', docusign_envelope_id: 'demo-env-2', sent_date: '2026-07-02T14:00:00Z', signed_date: null, created_at: '2026-06-30T09:00:00Z', updated_at: '2026-07-02T14:00:00Z', content: { clientName: 'Sam Petrosian', projectAddress: '22 Ridge Hollow Rd, Berkeley Heights NJ', scope: 'Second-floor addition over existing garage', designPhases: 2, fee: 21500 } },
  { id: 'pr-3', job_id: '26_041_Whitaker', template_id: null, status: 'signed', docusign_envelope_id: 'demo-env-3', sent_date: '2026-06-24T11:00:00Z', signed_date: '2026-06-30T16:20:00Z', created_at: '2026-06-22T10:00:00Z', updated_at: '2026-06-30T16:20:00Z', content: { clientName: 'Marcus Whitaker', projectAddress: '318 GlenAyre Dr, Scotch Plains NJ', scope: 'Rear addition and kitchen renovation', designPhases: 2, fee: 24000 } },
];

export const LETTERS = [
  { id: 'lt-1', job_id: '25_048_FE_Kestrel', created_at: '2026-07-10T10:00:00Z', updated_at: '2026-07-10T10:00:00Z', content: { recipient: 'Montclair Building Department', subject: 'Fire escape replacement — 88 Bloomfield Ave', body: 'Please find enclosed the filing set for the replacement of the existing fire escape…' } },
  { id: 'lt-2', job_id: '26_038_Okonkwo', created_at: '2026-07-16T10:00:00Z', updated_at: '2026-07-16T10:00:00Z', content: { recipient: 'Fanwood Zoning Board', subject: 'Setback variance request — 9 Tanglewood Ct', body: 'On behalf of our client we respectfully request a variance from the side-yard setback…' } },
];

// -------------------------------------------------------------- Field notes

export const FIELD_NOTES = [
  { id: 'fn-1', job_id: '25_033_Rosewood_Court', phase: 'construction', body: 'Rough electrical complete on floors 1–2. Panel location shifted 18" west of the plan — coordinate with the framing plan before closing walls.', author_name: 'Ray Arocha', author_email: 'raymond@rm117.com', created_at: '2026-07-21T18:30:00Z', updated_at: '2026-07-21T18:30:00Z', attachments: [], latitude: null, longitude: null },
  { id: 'fn-2', job_id: '25_033_Rosewood_Court', phase: 'construction', body: 'Window openings at the south elevation are framed 2" narrow. GC to verify against the schedule before ordering.', author_name: 'Ray Arocha', author_email: 'raymond@rm117.com', created_at: '2026-07-07T15:10:00Z', updated_at: '2026-07-07T15:10:00Z', attachments: [], latitude: null, longitude: null },
  { id: 'fn-3', job_id: '24_071_Varga_Rental', phase: 'construction', body: 'Punch list walkthrough: 14 items, mostly paint and trim. Stair handrail height needs correction — measured 32", requires 34" minimum.', author_name: 'Nicole Barros', author_email: 'nicole@rm117.com', created_at: '2026-07-15T14:00:00Z', updated_at: '2026-07-15T14:00:00Z', attachments: [], latitude: null, longitude: null },
];

// Payment totals are derived from the jobs fixture so the portal's billing strip
// and the BMS outstanding column can never disagree.
export const PAYMENTS_BY_JOB = PAYMENTS.reduce((m, p) => {
  (m[p.job_id] ||= []).push(p);
  return m;
}, {});
