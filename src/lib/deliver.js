// Ship a generated PDF (raw bytes) to /api/deliver, which files it into the job's
// Drive folder (letter → "Files Sent", proposal → "Proposal") and logs it. Returns
// the parsed response ({ folder, file, logged }); throws Error(message) on failure
// so callers just surface e.message.
import { apiFetch } from './api.js';
import { bytesToBase64 } from './doc-assets.js';

export async function deliverPdf({ jobId, kind, filename, bytes }) {
  const r = await apiFetch('/api/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, kind, filename, pdf: bytesToBase64(bytes) }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Send failed');
  return d;
}
