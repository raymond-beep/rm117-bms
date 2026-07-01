// GET /api/qbo/financials — firm-level financial snapshot for the Financial tab.
// Read-only. Pulls two things from QuickBooks and normalizes them:
//   • receivables — open A/R (from `Invoice where Balance > 0`), bucketed by age
//   • pnl         — Profit & Loss for a period (default: year-to-date)
//
// Query params:
//   ?start=&end= ('YYYY-MM-DD') — P&L window (default: Jan 1 this year → today)
//   ?ar=recent|all             — A/R scope. 'recent' (default) hides invoices for
//                                jobs older than 2025 (Job IDs '24_…' and earlier),
//                                which are pending QuickBooks cleanup and may be
//                                stale; 'all' shows the full open A/R book.
//
// Staff-gated. When QBO isn't configured it returns 200 {configured:false} so the
// UI can show a friendly "connect QuickBooks" state rather than an error — same
// pattern as /api/qbo/status. Each read is isolated: if the P&L call fails the
// receivables still return (and vice-versa), with the error surfaced per-section.
import { requireStaff } from '../_lib/require-staff.js';
import { hasQbo, listOpenInvoices, getProfitAndLoss } from '../_lib/qbo.js';
import { summarizeReceivables, parseProfitAndLoss } from '../_lib/qbo-reports.js';

// 'YYYY-MM-DD' in local time (avoids a UTC toISOString day-shift).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The A/R "recent" filter cutoff: hide jobs with a Job-ID year below this (2-digit).
// 25 = 2025 → invoices for 24_… and older jobs are hidden by default.
const RECENT_MIN_JOB_YEAR = 25;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasQbo()) return res.status(200).json({ configured: false });

  const now = new Date();
  const start = (req.query?.start) || isoDate(new Date(now.getFullYear(), 0, 1)); // Jan 1
  const end = (req.query?.end) || isoDate(now);
  const arScope = req.query?.ar === 'all' ? 'all' : 'recent';
  const minJobYear = arScope === 'all' ? null : RECENT_MIN_JOB_YEAR;

  // Run both reads concurrently; isolate failures so one bad report doesn't blank
  // the whole tab. A rejected read becomes { error } on its section.
  const [arResult, pnlResult] = await Promise.allSettled([
    listOpenInvoices(),
    getProfitAndLoss(start, end),
  ]);

  const receivables = arResult.status === 'fulfilled'
    ? summarizeReceivables(arResult.value, now, { minJobYear })
    : { error: arResult.reason?.message || 'A/R lookup failed' };

  const pnl = pnlResult.status === 'fulfilled'
    ? parseProfitAndLoss(pnlResult.value)
    : { error: pnlResult.reason?.message || 'P&L lookup failed' };

  return res.status(200).json({
    configured: true,
    asOf: now.toISOString(),
    period: { start, end },
    arScope,
    receivables,
    pnl,
  });
}
