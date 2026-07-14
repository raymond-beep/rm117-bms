// GET /api/drive/new-folders — job/lead folders created in Drive since the sync's
// start line that the app doesn't have yet. The "New in Drive" strip on the board.
//
// Read-only: it never creates a job. Importing is an explicit staff action
// (api/drive/import.js), because a folder name carries no phase, no client record and
// no contract value — and a bogus Job ID is a QuickBooks matching problem later.
//
// The full scan is ~3,600 folders / 4 Drive pages, so it's cached for 60s per warm
// instance. The board polls this on load; staff don't create folders by the second.
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { hasDrive, listAllFolders } from '../_lib/google-drive.js';
import { buildQueue } from '../_lib/drive-sync.js';

let _cache = null; // { at, payload }
const TTL_MS = 60_000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireStaff(req, res))) return; // 401/403 already sent

  if (!hasDrive()) return res.status(200).json({ source: 'no-drive', queue: [] });
  if (!hasDb()) return res.status(200).json({ source: 'no-db', queue: [] });

  if (req.query.fresh !== '1' && _cache && Date.now() - _cache.at < TTL_MS) {
    return res.status(200).json({ ..._cache.payload, cached: true });
  }

  try {
    const db = getDb();
    const [{ folders, source }, jobsRes, syncRes, dismissedRes] = await Promise.all([
      listAllFolders(),
      db.from('jobs').select('job_id'),
      db.from('drive_sync').select('watermark').eq('id', 1).maybeSingle(),
      db.from('drive_sync_dismissed').select('drive_folder_id'),
    ]);

    if (jobsRes.error) throw jobsRes.error;

    const watermark = syncRes.data?.watermark || null;
    const queue = buildQueue(folders, jobsRes.data || [], {
      watermark,
      dismissedIds: (dismissedRes.data || []).map((r) => r.drive_folder_id),
    });

    // Best-effort: a failed timestamp write must not fail the read.
    db.from('drive_sync').update({ last_scan_at: new Date().toISOString() }).eq('id', 1).then(
      () => {},
      (err) => console.error('[drive-sync] last_scan_at write failed', err),
    );

    const payload = { source, watermark, scanned: folders.length, queue };
    _cache = { at: Date.now(), payload };
    res.status(200).json(payload);
  } catch (err) {
    console.error('[drive-sync] scan failed', err);
    res.status(500).json({ error: err.message });
  }
}
