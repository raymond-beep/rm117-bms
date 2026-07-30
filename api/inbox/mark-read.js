// POST /api/inbox/mark-read — clear the UNREAD label on a thread.
//
// Body: { threadId, unread?: false }   (unread:true marks it back as unread)
//
// ⚠️ NEEDS THE `gmail.modify` SCOPE, which is wider than the `gmail.readonly`
// the Mail page otherwise runs on: modify can change labels and move mail, not
// just read it. It is here because without it the app and Gmail drift apart —
// mail read in the app stays bold in Gmail forever, and the unread count on the
// Mail page never matches the one people actually trust.
//
// Until every staffer has signed out and re-consented, this returns a clean
// `scope_not_granted` rather than an error, and the UI simply keeps unread state
// display-only. Nothing else on the page depends on it succeeding.
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken } from '../_lib/clerk.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await requireStaff(req, res);
  if (!userId) return;

  const { threadId, unread = false } = req.body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(200).json({ ok: false, reason: error });

  try {
    const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        unread ? { addLabelIds: ['UNREAD'] } : { removeLabelIds: ['UNREAD'] },
      ),
    });

    if (r.status === 401 || r.status === 403) {
      // Expected until the scope is added AND the staffer re-consents. Not an
      // error the user needs to see — reading still worked.
      return res.status(200).json({ ok: false, reason: 'scope_not_granted' });
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[api/inbox/mark-read]', r.status, body.slice(0, 200));
      return res.status(200).json({ ok: false, reason: `gmail_${r.status}` });
    }

    res.status(200).json({ ok: true, threadId, unread });
  } catch (err) {
    console.error('[api/inbox/mark-read]', err);
    res.status(200).json({ ok: false, reason: 'request_failed' });
  }
}
