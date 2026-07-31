// GET /api/inbox/correspondence?jobId=<Job ID> — one job's client-communication
// history, read from the app's own copy.
//
// ⭐ NO GMAIL TOKEN IS USED HERE, and that is the entire point. Filing copies the
// text of a thread into Supabase so a colleague can read what a client said
// WITHOUT access to the mailbox it landed in. Until this endpoint existed that
// copy was write-only: filing wrote a record nothing could read back, so the
// promise ("anyone can catch up on this job") was unproven.
//
// Merges two sources into one timeline — filed Gmail threads and the "Notify
// client" sends — because staff think of them as a single history of what this
// client has been told. See api/_lib/correspondence.js for why.
//
// Staff-gated, read-only. Never writes, never sends.
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { buildTimeline, summarize } from '../_lib/correspondence.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const userId = await requireStaff(req, res);
  if (!userId) return;
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });

  const jobId = new URL(req.url, 'http://localhost').searchParams.get('jobId');
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  const db = getDb();

  // Which threads are filed against this job?
  const { data: links, error: lErr } = await db
    .from('mail_thread_jobs').select('thread_id').eq('job_id', jobId);
  if (lErr) return res.status(500).json({ error: lErr.message });

  const threadIds = (links || []).map((l) => l.thread_id);

  let threads = [];
  if (threadIds.length) {
    // Nested select so the whole conversation arrives in one round trip. The
    // messages carry the participant list, which is what the client-facing view
    // filters on — kept here so the staff view can SHOW that a message the
    // client was never on is in the thread.
    const { data, error } = await db
      .from('mail_threads')
      .select(`
        id, gmail_thread_id, subject, last_message_at, message_count,
        visible_to_client, filed_at, filed_by,
        mail_thread_jobs ( job_id ),
        messages:mail_messages (
          id, gmail_message_id, from_name, from_email, participants,
          sent_at, body_text, body_html, has_attachments, hidden_from_client,
          attachments:mail_attachments (
            filename, mime_type, size_bytes, drive_file_id
          )
        )
      `)
      .in('id', threadIds);
    if (error) return res.status(500).json({ error: error.message });
    threads = data || [];
  }

  // What has the client been told through the portal? Read independently — a
  // missing/empty notifications table must not blank out the filed threads.
  const { data: notifications } = await db
    .from('notifications')
    .select('id, type, status, to_email, subject, body, sent_by, sent_at, error, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(50);

  const timeline = buildTimeline({ threads, notifications: notifications || [] });

  res.status(200).json({
    jobId,
    timeline,
    summary: summarize(timeline),
  });
}
