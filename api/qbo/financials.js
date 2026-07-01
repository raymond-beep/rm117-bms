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
} from '../_lib/qbo.js';
import {
  summarizeReceivables,
  parseProfitAndLoss,
  parseProfitAndLossColumns,
  toTopInvoices,
} from '../_lib/qbo-reports.js';

// 'YYYY-MM-DD' in local time (avoids a UTC toISOString day-shift).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The A/R "recent" filter cutoff: hide jobs with a Job-ID year below this (2-digit).
// 25 = 2025 → invoices for 24_… and older jobs are hidden by default.
const RECENT_MIN_JOB_YEAR = 25;

// How many quarters back the comparison chart spans (including the current one).
const QUARTER_WINDOW = 6;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasQbo()) return res.status(200).json({ configured: false });

  const now = new Date();
  const start = (req.query?.start) || isoDate(new Date(now.getFullYear(), 0, 1)); // Jan 1
  const end = (req.query?.end) || isoDate(now);
  const arScope = req.query?.ar === 'all' ? 'all' : 'recent';
  const minJobYear = arScope === 'all' ? null : RECENT_MIN_JOB_YEAR;

  // Trailing quarter window: first day of the quarter (WINDOW-1) quarters ago →
  // last day of the current quarter, so the comparison shows exactly WINDOW full
  // quarter columns (the current one partial).
  const curQStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const qWinStart = new Date(curQStart.getFullYear(), curQStart.getMonth() - (QUARTER_WINDOW - 1) * 3, 1);
  const qWinEnd = new Date(curQStart.getFullYear(), curQStart.getMonth() + 3, 0); // last day of current quarter
  const today = isoDate(now);

  const [arResult, pnlResult, qtrResult, topResult] = await Promise.allSettled([
    listOpenInvoices(),
    getProfitAndLoss(start, end),
    getProfitAndLoss(isoDate(qWinStart), isoDate(qWinEnd), 'Quarter'),
    listInvoicesInPeriod(start, end, 8),
  ]);

  const receivables = arResult.status === 'fulfilled'
    ? summarizeReceivables(arResult.value, now, { minJobYear })
    : { error: arResult.reason?.message || 'A/R lookup failed' };

  const pnl = pnlResult.status === 'fulfilled'
    ? parseProfitAndLoss(pnlResult.value)
    : { error: pnlResult.reason?.message || 'P&L lookup failed' };

  // Flag the in-progress quarter (its period extends past today) so the UI can
  // mark it "so far" rather than comparing a partial quarter as if it were done.
  const pnlQuarters = qtrResult.status === 'fulfilled'
    ? parseProfitAndLossColumns(qtrResult.value).map((q) => ({ ...q, partial: !!q.end && q.end > today }))
    : { error: qtrResult.reason?.message || 'Quarterly P&L lookup failed' };

  const topInvoices = topResult.status === 'fulfilled'
    ? toTopInvoices(topResult.value, 8)
    : { error: topResult.reason?.message || 'Top-invoice lookup failed' };

  return res.status(200).json({
    configured: true,
    asOf: now.toISOString(),
    period: { start, end },
    arScope,
    pnl,
    pnlQuarters,
    topInvoices,
    receivables,
  });
}
