// /api/field-notes/upload — store a photo/voice attachment for a field note.
//   POST { job_id, kind: 'photo'|'voice', dataUrl, name? }
//        -> { type, path, name, content_type }
//
// Staff-only (valid Clerk token). The file arrives as a data URL (base64); we
// decode it, push it into the private `field-notes` Storage bucket under the
// job's folder, and return the storage path. The note itself is saved separately
// via POST /api/field-notes with this path in its `attachments` array. Download
// URLs are signed on read by GET /api/field-notes — the bucket stays private.
import { randomUUID } from 'node:crypto';
import { getDb, hasDb, JOB_ID_RE } from '../_lib/db.js';
import { hasClerk, getUserId } from '../_lib/clerk.js';

const BUCKET = 'field-notes';

// mime -> file extension for the stored object.
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Staff gate — author identity also confirms a real session.
  if (hasClerk() && !(await getUserId(req))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { job_id, kind, dataUrl, name } = req.body || {};
  if (!job_id || !JOB_ID_RE.test(job_id)) return res.status(400).json({ error: 'A valid job_id is required' });
  if (kind !== 'photo' && kind !== 'voice') return res.status(400).json({ error: "kind must be 'photo' or 'voice'" });

  // Parse "data:<mime>;base64,<payload>"
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return res.status(400).json({ error: 'dataUrl must be a base64 data URL' });
  const contentType = m[1];
  const ext = EXT[contentType];
  if (!ext) return res.status(400).json({ error: `Unsupported content type: ${contentType}` });

  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) return res.status(400).json({ error: 'Empty file' });

  if (!hasDb()) return res.status(200).json({ source: 'mock', path: null });

  const path = `${job_id}/${randomUUID()}.${ext}`;
  try {
    const db = getDb();
    const { error } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
    res.status(201).json({
      source: 'supabase',
      type: kind,
      path,
      name: typeof name === 'string' && name ? name : `${kind}.${ext}`,
      content_type: contentType,
    });
  } catch (err) {
    console.error('[api/field-notes/upload]', err);
    res.status(500).json({ error: err.message });
  }
}
