// POST /api/inbox/compose — start a NEW email conversation from a job.
//
// The Mail tab could only ever answer mail that already existed. Everything else —
// "send the survey to the developer's PM", "ask the township about the variance" —
// still meant leaving the app, which is the gap that keeps a job's correspondence
// half in the app and half in someone's head.
//
// ⚠️ THE RECIPIENT RULE IS THE WHOLE SECURITY MODEL HERE.
//
// A reply is safe because the server recomputes its recipients from the message
// being answered: the UI can DROP an address but never add one, so a staff Gmail
// account cannot be pointed at an arbitrary address. A compose has no source
// message, so that subtraction has nothing to subtract from — the naive version of
// this endpoint ("send `to` from the request body") would hand any authenticated
// staff session an open relay running as a real person at a real firm.
//
// So the caller sends CONTACT IDS, never addresses, and the server resolves them
// against `client_contacts` for the client that owns this job. The set of people
// reachable from here is exactly "the contacts a staffer already added to this
// client", which is also the list the portal mails magic links to. Adding a new
// recipient is a deliberate act in the contacts UI, not a free-text field in a
// compose box.
//
// Body: { jobId, contactIds: [uuid], subject, text, fileToJob = true }
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { getUserEmail } from '../_lib/clerk.js';
import { sendAsUser } from '../_lib/gmail-send.js';
import { resolveRecipients, formatRecipients } from '../_lib/correspondence.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await requireStaff(req, res);
  if (!userId) return;
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });

  const {
    jobId, contactIds = [], subject, text, fileToJob = true,
  } = req.body || {};

  if (!jobId) return res.status(400).json({ error: 'jobId is required' });
  if (!String(subject || '').trim()) return res.status(400).json({ error: 'A subject is required' });
  if (!String(text || '').trim()) return res.status(400).json({ error: 'Message body is empty' });
  if (!Array.isArray(contactIds) || !contactIds.length) {
    return res.status(400).json({ error: 'Pick at least one recipient' });
  }

  const db = getDb();

  const { data: job } = await db.from('jobs')
    .select('job_id, client_id, client_name').eq('job_id', jobId).maybeSingle();
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  if (!job.client_id) {
    // ~29 Drive-imported jobs have no client. Without one there is no contact list
    // to resolve against, so there is no safe recipient set — refuse rather than
    // fall back to a free-text address.
    return res.status(409).json({
      error: 'This job has no client linked, so there are no contacts to email. Link a client first.',
      code: 'no_client',
    });
  }

  // Resolve ids → addresses. Deactivated contacts are excluded: a PM who left the
  // developer must stop being emailable, the same rule that revokes their portal
  // link on removal.
  const { data: contacts } = await db.from('client_contacts')
    .select('id, name, email, is_active')
    .eq('client_id', job.client_id);

  const chosen = resolveRecipients(contacts, contactIds);

  if (!chosen.length) {
    return res.status(400).json({
      error: 'None of those recipients are active contacts on this client.',
      code: 'no_valid_recipients',
    });
  }

  const me = (await getUserEmail(userId)) || '';
  const toList = formatRecipients(chosen);

  let sent;
  try {
    sent = await sendAsUser(userId, {
      to: toList,
      subject: String(subject).trim(),
      text: String(text),
      fromName: me || undefined,
    });
  } catch (err) {
    if (err.code === 'google_send_not_granted' || err.code === 'google_not_connected') {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    console.error('[api/inbox/compose]', err);
    return res.status(500).json({ error: err.message || 'Send failed' });
  }

  // File it against the job straight away.
  //
  // This does NOT break "filing is always a staff action, never a sync". That rule
  // exists because INFERRING a job from a subject line and a sender is a guess, and
  // a wrong link is worse than none. Here there is nothing to infer: the staffer
  // opened this job and wrote this email from it. Recording what they just did is
  // the opposite of a guess.
  let filed = false;
  if (fileToJob) {
    try {
      const now = new Date().toISOString();
      const { data: thread } = await db.from('mail_threads').upsert({
        gmail_thread_id: sent.threadId,
        subject: String(subject).trim(),
        client_id: job.client_id,
        last_message_at: now,
        message_count: 1,
        filed_by: String(userId),
      }, { onConflict: 'gmail_thread_id' }).select('id').single();

      if (thread) {
        await db.from('mail_thread_jobs').upsert(
          { thread_id: thread.id, job_id: job.job_id, added_by: String(userId) },
          { onConflict: 'thread_id,job_id' },
        );
        await db.from('mail_messages').upsert({
          thread_id: thread.id,
          gmail_message_id: sent.id,
          from_name: me,
          from_email: me,
          participants: [me, ...chosen.map((c) => c.email.toLowerCase())],
          sent_at: now,
          body_text: String(text),
          has_attachments: false,
        }, { onConflict: 'thread_id,gmail_message_id' });
        filed = true;
      }
    } catch (err) {
      // The mail is already gone; a filing failure must not read as a send failure
      // or someone will send it twice.
      console.error('[api/inbox/compose] filed=false', err);
    }
  }

  res.status(200).json({
    ok: true,
    id: sent.id,
    threadId: sent.threadId,
    to: chosen.map((c) => c.email),
    filed,
  });
}
