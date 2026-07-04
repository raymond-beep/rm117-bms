// POST /api/checksets/export — flatten reviewer markup onto the original checkset
// PDF and save the reviewed copy back to the job's Drive "Checksets" folder.
//
//   body: { setId, pages: [{ page:number, pngBase64:string }] }
//   -> { ok:true, fileId, name, webViewLink, pagesStamped }
//
// The original PDF vectors are preserved: for each marked page the client sends a
// TRANSPARENT PNG of just the tldraw strokes, sized to the page's *visible*
// (rotation-applied) box, and pdf-lib stamps it over the existing page content.
// Because a set can mix page rotations (permit sets often have a rotated cover
// sheet), the stamp is placed rotation-aware so marks land in the right place and
// orientation on /Rotate 90/180/270 pages too.
//
// Prereq: the Drive service account must be a Content manager on the Shared Drive
// (writes 403 otherwise — same gate as letters/proposals delivery).
import { PDFDocument, degrees } from 'pdf-lib';
import { requireStaff } from '../_lib/require-staff.js';
import { getDb } from '../_lib/db.js';
import {
  hasDrive,
  resolveChecksetsFolderId,
  downloadFileBytes,
  uploadToFolder,
} from '../_lib/google-drive.js';

// Cap payload abuse: a set is at most a few dozen sheets and each PNG is a thin
// ink layer, but bound both so a malformed request can't exhaust memory.
const MAX_PAGES = 200;

// "Permit Set 04.pdf" -> "Permit Set 04". Also strips a trailing " (QA …)" so a
// re-export of an already-exported copy doesn't stack suffixes.
function baseName(filename) {
  return String(filename || 'Checkset')
    .replace(/\.pdf$/i, '')
    .replace(/\s*[—-]\s*QA\s+\d{4}-\d{2}-\d{2}\s*$/i, '')
    .trim() || 'Checkset';
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Place a full-page overlay image so it covers the page's VISIBLE area in the
// correct orientation, whatever the page's /Rotate. drawImage works in unrotated
// user space, so on a rotated page we pre-rotate + offset the stamp to cancel the
// viewer's rotation. Derivation verified for 0/90/180/270.
export function stampFullPage(page, png) {
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const { width, height } = page.getSize(); // unrotated media box
  const rotated = angle === 90 || angle === 270;
  const drawW = rotated ? height : width; // visible width
  const drawH = rotated ? width : height; // visible height
  let x = 0;
  let y = 0;
  if (angle === 90) { x = width; y = 0; }
  else if (angle === 180) { x = width; y = height; }
  else if (angle === 270) { x = 0; y = height; }
  page.drawImage(png, { x, y, width: drawW, height: drawH, rotate: degrees(angle) });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const userId = await requireStaff(req, res);
  if (!userId) return; // 401/403 already sent

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Database not configured' });
  if (!hasDrive()) return res.status(503).json({ error: 'Google Drive is not configured' });

  const body = req.body || {};
  const setId = String(body.setId ?? '').trim();
  const pages = Array.isArray(body.pages) ? body.pages : null;
  if (!setId) return res.status(400).json({ error: 'setId is required' });
  if (!pages || pages.length === 0) {
    return res.status(400).json({ error: 'No marked pages to export' });
  }
  if (pages.length > MAX_PAGES) return res.status(400).json({ error: 'Too many pages' });

  try {
    // 1. The set tells us the source Drive PDF + which job it belongs to.
    const { data: set, error: setErr } = await db
      .from('drawing_sets')
      .select('id, job_number, drive_file_id, original_filename')
      .eq('id', setId)
      .single();
    if (setErr || !set) return res.status(404).json({ error: 'Set not found' });
    if (!set.drive_file_id) {
      return res.status(400).json({ error: 'This set has no source Drive file to export' });
    }

    // 2. Resolve the destination folder first — if the job has no Checksets
    // folder we fail fast before doing the heavy PDF work.
    const folderId = await resolveChecksetsFolderId(set.job_number);
    if (!folderId) {
      return res.status(409).json({ error: 'No Checksets folder for this job in Drive' });
    }

    // 3. Load the original PDF and stamp each marked page.
    const originalBytes = await downloadFileBytes(set.drive_file_id);
    const pdf = await PDFDocument.load(originalBytes, { updateMetadata: false });
    const pdfPages = pdf.getPages();

    let stamped = 0;
    for (const entry of pages) {
      const pageNum = Number(entry?.page);
      const pngBase64 = typeof entry?.pngBase64 === 'string' ? entry.pngBase64 : null;
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfPages.length) continue;
      if (!pngBase64) continue;
      const png = await pdf.embedPng(Buffer.from(pngBase64, 'base64'));
      stampFullPage(pdfPages[pageNum - 1], png);
      stamped += 1;
    }
    if (stamped === 0) {
      return res.status(400).json({ error: 'No valid marked pages to export' });
    }

    const outBytes = await pdf.save();

    // 4. Upload the reviewed copy into the job's Checksets folder.
    const name = `${baseName(set.original_filename)} — QA ${todayStamp()}.pdf`;
    const uploaded = await uploadToFolder(folderId, {
      name,
      mimeType: 'application/pdf',
      bytes: outBytes,
    });

    return res.status(200).json({
      ok: true,
      fileId: uploaded.id,
      name: uploaded.name,
      webViewLink: uploaded.webViewLink ?? null,
      pagesStamped: stamped,
    });
  } catch (err) {
    console.error('[checksets/export]', err);
    // A 403 here almost always means the service account isn't a Content manager
    // on the Shared Drive yet — surface that plainly.
    const msg = /403|permission|insufficient/i.test(err.message || '')
      ? 'Drive rejected the write — the service account needs Content manager on the Shared Drive.'
      : err.message;
    return res.status(500).json({ error: msg });
  }
}
