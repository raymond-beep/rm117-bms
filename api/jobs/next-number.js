// GET /api/jobs/next-number?yy=26 — the job numbers already used in Google Drive
// for a 2-digit year, so the New Job builder can recommend the truly-next number.
//
// Why Drive and not just the app DB: until the app fully takes over, the firm keeps
// filing new jobs in the Shared Drive too, so a job can exist in Drive before it's
// added here. Recommending max(DB, Drive) + 1 avoids proposing a number that's
// already taken in Drive (Angelena hit this). Read-only; staff-gated.
import { requireStaff } from '../_lib/require-staff.js';
import { listJobNumbersForYear } from '../_lib/google-drive.js';

const YY_RE = /^\d{2}$/;

export default async function handler(req, res) {
  const userId = await requireStaff(req, res);
  if (!userId) return; // 401/403 already sent
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const yy = String(req.query.yy || '').padStart(2, '0');
  if (!YY_RE.test(yy)) return res.status(400).json({ error: 'yy is required (2 digits, e.g. 26)' });

  try {
    const { numbers, max, source } = await listJobNumbersForYear(yy);
    res.status(200).json({ yy, driveMax: max, driveNumbers: numbers, source });
  } catch (err) {
    console.error('[api/jobs/next-number]', err);
    res.status(500).json({ error: err.message });
  }
}
