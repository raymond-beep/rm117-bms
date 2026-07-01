// GET /api/qbo/financials — firm-level financial snapshot for the Financial tab.
// Read-only. Pulls from QuickBooks and normalizes:
//   • pnl         — Profit & Loss for the selected period (default: year-to-date)
//   • pnlQuarters — P&L summarized by quarter over a trailing 6-quarter window
//                   (the quarter-over-quarter comparison)
//   • topInvoices — the largest invoices billed in the selected period
//   • receivables — open A/R (from `Invoice where Balance > 0`), bucketed by age
//
// Query params:
//   ?start=&end= ('YYYY-MM-DD') — P&L / top-invoice window (default: Jan 1 → today)
//   ?basis=sent|cash|accrual   — income basis for the P&L sections (pnl / pnlQuarters):
//                                • 'sent' (default) — income = invoices *sent* in the
//                                  period (work completed → billed, paid or not), dated
//                                  by QBO's real send timestamp. This is how the firm
//                                  tracks its books. Expenses are paired from the
//                                  accrual P&L (work-performed basis).
//                                • 'cash' — income when payment is received.
//                                • 'accrual' — income when an invoice is created
//                                  (incl. invoices drafted in advance).
//                                A/R and top-invoices are invoice-based regardless.
//   ?ar=recent|all             — A/R scope. 'recent' (default) hides invoices for
//                                jobs older than 2025 (Job IDs '24_…' and earlier),
//                                which are pending QuickBooks cleanup and may be
//                                stale; 'all' shows the full open A/R book.
//
// Staff-gated. When QBO isn't configured it returns 200 {configured:false} so the
// UI can show a friendly "connect QuickBooks" state rather than an error — same
// pattern as /api/qbo/status. Each read is isolated (Promise.allSettled): one bad
// report surfaces as { error } on its own section without blanking the others.
import { requireStaff } from '../_lib/require-staff.js';
import {
  hasQbo,
  listOpenInvoices,
  getProfitAndLoss,
  listInvoicesInPeriod,
  listInvoicesByTxnWindow,
} from '../_lib/qbo.js';
import {
  summarizeReceivables,
  parseProfitAndLoss,
  parseProfitAndLossColumns,
  sumSentInPeriod,
  invoiceSendDate,
  toTopInvoices,
} from '../_lib/qbo-reports.js';

// 'YYYY-MM-DD' in local time (avoids a UTC toISOString day-shift).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The A/R "recent" filter cutoff: hide jobs with a Job-ID year below this (2-digit).
// 25 = 2025 → invoices for 24_… and older jobs are hidden by default.
const RECENT_MIN_JOB_YEAR = 25;

// How many quarters back the comparison chart spans (including the current one).
const QUARTER_WINDOW = 6;

// An invoice is often dated weeks before it's sent, so to catch everything *sent*
// within a window we fetch invoices whose TxnDate reaches this many days earlier.
const SENT_TXN_LOOKBACK_DAYS = 150;

// The firm only began emailing invoices through QuickBooks in late 2025, so earlier
// invoices carry no send-timestamp. In "Sent" mode we hide any historical quarter
// where fewer than this fraction of its invoices have a send date — otherwise its
// income collapses to near-zero and the chart shows a misleading loss. (The current,
// still-open quarter is always kept.)
const SENT_QUARTER_MIN_COVERAGE = 0.3;

// Fraction of a quarter's invoices (by TxnDate) that carry a real send date — our
// proxy for "was QuickBooks send-tracking in use this quarter?"
function quarterSendCoverage(invoices, start, end) {
  const inQ = (invoices || []).filter((i) => i.TxnDate >= start && i.TxnDate <= (end || start));
  if (inQ.length === 0) return 0;
  return inQ.filter((i) => invoiceSendDate(i)).length / inQ.length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasQbo()) return res.status(200).json({ configured: false });

  const now = new Date();
  const start = (req.query?.start) || isoDate(new Date(now.getFullYear(), 0, 1)); // Jan 1
  const end = (req.query?.end) || isoDate(now);
  const arScope = req.query?.ar === 'all' ? 'all' : 'recent';
  const minJobYear = arScope === 'all' ? null : RECENT_MIN_JOB_YEAR;
  // Income basis: 'sent' (default) = invoices sent (billed for completed work);
  // 'cash' = money received; 'accrual' = every invoice created.
  const basis = ['cash', 'accrual', 'sent'].includes(req.query?.basis) ? req.query.basis : 'sent';
  // Which QBO report basis backs the P&L. 'sent' reads the accrual report (for its
  // expenses + per-quarter columns) and overlays sent-invoice income on top.
  const qboMethod = basis === 'cash' ? 'Cash' : 'Accrual';

  // Trailing quarter window: first day of the quarter (WINDOW-1) quarters ago →
  // last day of the current quarter, so the comparison shows exactly WINDOW full
  // quarter columns (the current one partial).
  const curQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const qWinStart = new Date(curQStart.getFullYear(), curQStart.getMonth() - (QUARTER_WINDOW - 1) * 3, 1);
  const qWinEnd = new Date(curQStart.getFullYear(), curQStart.getMonth() + 3, 0); // last day of current quarter
  const today = isoDate(now);

  // For 'sent', fetch the invoice book (padded window covering both the selected
  // period and the quarter chart) so we can bucket by real send date. Skipped for
  // cash/accrual, which come straight from the P&L report.
  let sentInvoicesP = Promise.resolve(null);
  if (basis === 'sent') {
    const earliest = new Date(Math.min(new Date(start).getTime(), qWinStart.getTime()));
    earliest.setDate(earliest.getDate() - SENT_TXN_LOOKBACK_DAYS);
    const winEnd = end > today ? end : today; // include invoices sent right up to now
    sentInvoicesP = listInvoicesByTxnWindow(isoDate(earliest), winEnd);
  }

  const [arResult, pnlResult, qtrResult, topResult, sentResult] = await Promise.allSettled([
    listOpenInvoices(),
    getProfitAndLoss(start, end, undefined, qboMethod),
    getProfitAndLoss(isoDate(qWinStart), isoDate(qWinEnd), 'Quarter', qboMethod),
    listInvoicesInPeriod(start, end, 8),
    sentInvoicesP,
  ]);

  const receivables = arResult.status === 'fulfilled'
    ? summarizeReceivables(arResult.value, now, { minJobYear })
    : { error: arResult.reason?.message || 'A/R lookup failed' };

  // Sent invoices: fail loudly on this section only if we needed them and the fetch failed.
  const sentInvoices = sentResult.status === 'fulfilled' ? sentResult.value : null;
  const sentError = basis === 'sent' && sentResult.status === 'rejected'
    ? (sentResult.reason?.message || 'Invoice lookup failed')
    : null;

  // Period P&L. For 'sent', overlay sent-invoice income on the accrual report's
  // expenses (so Income − Expenses = Net stays consistent for the UI).
  let pnl;
  if (pnlResult.status !== 'fulfilled') {
    pnl = { error: pnlResult.reason?.message || 'P&L lookup failed' };
  } else if (basis === 'sent') {
    if (sentError) {
      pnl = { error: sentError };
    } else {
      const acc = parseProfitAndLoss(pnlResult.value);
      const expenses = round2(acc.income - acc.netIncome);
      const s = sumSentInPeriod(sentInvoices || [], start, end);
      pnl = {
        income: s.income,
        netIncome: round2(s.income - expenses),
        expenseAccounts: acc.expenseAccounts,
        sent: s, // { income, paid, open, count } — billed vs collected split
      };
    }
  } else {
    pnl = parseProfitAndLoss(pnlResult.value);
  }

  // Quarter comparison. Flag the in-progress quarter (extends past today) as "so far".
  let pnlQuarters;
  let sentQuartersHidden = 0;
  if (qtrResult.status !== 'fulfilled') {
    pnlQuarters = { error: qtrResult.reason?.message || 'Quarterly P&L lookup failed' };
  } else if (basis === 'sent' && sentError) {
    pnlQuarters = { error: sentError };
  } else {
    const cols = parseProfitAndLossColumns(qtrResult.value);
    if (basis === 'sent') {
      const built = cols.map((q) => {
        const partial = !!q.end && q.end > today;
        const si = sumSentInPeriod(sentInvoices || [], q.start, q.end).income;
        const expenses = round2(q.income - q.netIncome);
        const coverage = quarterSendCoverage(sentInvoices || [], q.start, q.end);
        return { start: q.start, end: q.end, label: q.label, income: si, netIncome: round2(si - expenses), partial, coverage };
      });
      // Hide historical quarters with no reliable send data (keep the current one).
      const kept = built.filter((q) => q.partial || q.coverage >= SENT_QUARTER_MIN_COVERAGE);
      sentQuartersHidden = built.length - kept.length;
      pnlQuarters = kept.map(({ coverage, ...q }) => q); // drop the internal coverage field
    } else {
      pnlQuarters = cols.map((q) => ({ ...q, partial: !!q.end && q.end > today }));
    }
  }

  const topInvoices = topResult.status === 'fulfilled'
    ? toTopInvoices(topResult.value, 8)
    : { error: topResult.reason?.message || 'Top-invoice lookup failed' };

  return res.status(200).json({
    configured: true,
    asOf: now.toISOString(),
    period: { start, end },
    basis,
    arScope,
    pnl,
    pnlQuarters,
    sentQuartersHidden,
    topInvoices,
    receivables,
  });
}
