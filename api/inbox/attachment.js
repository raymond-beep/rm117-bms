// GET /api/inbox/attachment?messageId=&attachmentId=&filename=[&inline=1]
// Streams one Gmail attachment back through the app.
//
// Why proxy it rather than hand the browser a Google URL: the Gmail API needs the
// staffer's OAuth token on every request, and that token must never reach the
// client — least of all the sandboxed iframe the email body renders in. The app
// fetches the bytes server-side and serves them from our own origin.
//
// Serves inline (?inline=1) for images the body references by Content-ID and for
// in-app PDF/image preview; as a download otherwise.
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken } from '../_lib/clerk.js';
import { gmailGet } from '../_lib/gmail-read.js';

// Only these render inline. Anything else downloads — an inline text/html
// attachment from an unknown sender would be same-origin script execution.
const INLINE_SAFE = /^(image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml)|application\/pdf|text\/plain)$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await requireStaff(req, res);
  if (!userId) return;

  const url = new URL(req.url, 'http://localhost');
  const messageId = url.searchParams.get('messageId');
  const attachmentId = url.searchParams.get('attachmentId');
  const filename = url.searchParams.get('filename') || 'attachment';
  const wantInline = url.searchParams.get('inline') === '1';
  if (!messageId || !attachmentId) {
    return res.status(400).json({ error: 'messageId and attachmentId are required' });
  }

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(409).json({ error: 'google_not_connected', reason: error });

  try {
    const att = await gmailGet(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      token,
    );
    const buf = Buffer.from(String(att.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    // Trust the request's mime only far enough to decide inline vs download;
    // an SVG is inline-safe but still scriptable, so it is never same-origin
    // rendered — the UI puts previews in a sandboxed frame.
    const mime = url.searchParams.get('mime') || '';
    const inline = wantInline && INLINE_SAFE.test(mime || 'application/octet-stream');

    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/["\\\r\n]/g, '')}"`,
    );
    // Private: this is one staffer's mail, behind their session.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).end(buf);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(409).json({ error: 'google_reauth_needed' });
    }
    if (err.status === 404) return res.status(404).json({ error: 'Attachment not found' });
    console.error('[api/inbox/attachment]', err);
    res.status(500).json({ error: err.message });
  }
}
