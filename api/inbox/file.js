// POST   /api/inbox/file   — file a Gmail thread against one or more jobs.
// GET    /api/inbox/file?threadId= | ?jobId=  — what is already filed.
// DELETE /api/inbox/file?threadId=            — unfile it.
//
// This is the piece that ties email to the work. The firm's client communication
// lives entirely in Gmail; filing copies the TEXT into Supabase so a colleague
// can read it without access to that person's mailbox, links it to the job(s),
// and puts any attachments where the firm already keeps what clients send —
// the job's Drive "Files Received" folder.
//
// ⚠️ FILING IS ALWAYS A STAFF ACTION, never a sync. A subject line and a sender
// are not enough to decide a thread belongs to a job, and a wrong link is worse
// than no link — the same rule the Drive → app sync runs on. The Mail page
// SUGGESTS jobs (from the client match); a person confirms them.
//
// ⚠️ Filing is internal. It does NOT show the thread to the client — that is a
// separate opt-in (`visible_to_client`), because filing something and publishing
// it to a client are different decisions.
import { getDb, hasDb } from '../_lib/db.js';
import { requireStaff } from '../_lib/require-staff.js';
import { getGoogleToken } from '../_lib/clerk.js';
import {
  gmailGet, headerMap, parseAddress, parseAddressList, walkParts,
  sanitizeEmailHtml, threadSubject, decodeB64Url, effectiveMime,
} from '../_lib/gmail-read.js';
import { hasDrive, resolveFilesReceivedFolderId, uploadToFolder } from '../_lib/google-drive.js';

// Everyone on a message, lowercased — what the client-facing view filters on so
// a client only ever sees messages they were personally on.
function participantsOf(h) {
  const all = [
    parseAddress(h.from || ''),
    ...parseAddressList(h.to || ''),
    ...parseAddressList(h.cc || ''),
  ];
  return [...new Set(all.map((a) => a.email).filter(Boolean))];
}

export default async function handler(req, res) {
  const userId = await requireStaff(req, res);
  if (!userId) return;
  if (!hasDb()) return res.status(503).json({ error: 'db_not_configured' });
  const db = getDb();
  const url = new URL(req.url, 'http://localhost');

  // ── What's filed? ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const threadId = url.searchParams.get('threadId');
    const jobId = url.searchParams.get('jobId');

    if (threadId) {
      const { data } = await db.from('mail_threads')
        .select('id, gmail_thread_id, subject, visible_to_client, filed_at, mail_thread_jobs(job_id)')
        .eq('gmail_thread_id', threadId).maybeSingle();
      return res.status(200).json({
        filed: Boolean(data),
        thread: data || null,
        jobs: (data?.mail_thread_jobs || []).map((r) => r.job_id),
      });
    }

    if (jobId) {
      const { data: links } = await db.from('mail_thread_jobs')
        .select('thread_id').eq('job_id', jobId);
      const ids = (links || []).map((l) => l.thread_id);
      if (!ids.length) return res.status(200).json({ threads: [] });
      const { data: threads } = await db.from('mail_threads')
        .select('id, gmail_thread_id, subject, last_message_at, message_count, visible_to_client')
        .in('id', ids).order('last_message_at', { ascending: false });
      return res.status(200).json({ threads: threads || [] });
    }
    return res.status(400).json({ error: 'threadId or jobId required' });
  }

  // ── Unfile ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const threadId = url.searchParams.get('threadId');
    if (!threadId) return res.status(400).json({ error: 'threadId required' });
    // Removes the app's record and its job links. Nothing is deleted from Gmail
    // or from Drive — files already filed stay where the firm put them.
    const { error } = await db.from('mail_threads').delete().eq('gmail_thread_id', threadId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, unfiled: threadId });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    threadId, jobIds = [], clientId: clientIdIn = null,
    saveAttachments = true, visibleToClient = false,
    hiddenMessageIds = [],
  } = req.body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });
  if (!Array.isArray(jobIds) || !jobIds.length) {
    return res.status(400).json({ error: 'Pick at least one job to file this against' });
  }

  // The portal is keyed by CLIENT while the rest of the app speaks Job ID, so
  // derive the client from the job unless one was given explicitly.
  let clientId = clientIdIn;
  if (!clientId) {
    const { data: job } = await db.from('jobs').select('client_id').eq('job_id', jobIds[0]).maybeSingle();
    clientId = job?.client_id || null;
  }

  const { token, error } = await getGoogleToken(userId);
  if (error) return res.status(409).json({ error: 'google_not_connected', reason: error });

  try {
    const gthread = await gmailGet(`/threads/${encodeURIComponent(threadId)}?format=full`, token);
    const gmsgs = gthread.messages || [];
    if (!gmsgs.length) return res.status(404).json({ error: 'Thread has no messages' });

    // Parse every message once — bodies, participants, attachment manifests.
    const parsed = await Promise.all(gmsgs.map(async (msg) => {
      const h = headerMap(msg.payload);
      const parts = walkParts(msg.payload);
      // Large bodies arrive out of line (see walkParts); fetch them or the filed
      // copy would be blank exactly where the conversation was longest.
      if (!parts.html && parts.htmlRef) {
        parts.html = decodeB64Url(
          (await gmailGet(`/messages/${msg.id}/attachments/${parts.htmlRef}`, token).catch(() => ({}))).data,
        );
      }
      if (!parts.text && parts.textRef) {
        parts.text = decodeB64Url(
          (await gmailGet(`/messages/${msg.id}/attachments/${parts.textRef}`, token).catch(() => ({}))).data,
        );
      }
      const from = parseAddress(h.from || '');
      return {
        msg, h, parts, from,
        participants: participantsOf(h),
        sentAt: h.date ? new Date(h.date).toISOString() : null,
      };
    }));

    const subject = threadSubject(parsed.map((p) => ({ subject: p.h.subject })));
    const lastAt = parsed.map((p) => p.sentAt).filter(Boolean).sort().pop() || null;

    // Upsert the thread record.
    const { data: thread, error: tErr } = await db.from('mail_threads').upsert({
      gmail_thread_id: threadId,
      subject,
      client_id: clientId,
      last_message_at: lastAt,
      message_count: parsed.length,
      visible_to_client: Boolean(visibleToClient),
      shared_at: visibleToClient ? new Date().toISOString() : null,
      shared_by: visibleToClient ? String(userId) : null,
      filed_by: String(userId),
    }, { onConflict: 'gmail_thread_id' }).select('id').single();
    if (tErr) return res.status(500).json({ error: tErr.message });

    // Link the jobs (additive — filing again with another job keeps the first).
    const links = jobIds.map((job_id) => ({
      thread_id: thread.id, job_id, added_by: String(userId),
    }));
    const { error: lErr } = await db.from('mail_thread_jobs')
      .upsert(links, { onConflict: 'thread_id,job_id' });
    if (lErr) return res.status(500).json({ error: lErr.message });

    // Store the message text. Re-filing updates in place (unique thread+message).
    // `hidden_from_client` records the outcome of the share preview: the whole
    // thread is shown by default, and excluding a message is the deliberate act.
    const hidden = new Set(Array.isArray(hiddenMessageIds) ? hiddenMessageIds : []);
    const rows = parsed.map((p) => ({
      thread_id: thread.id,
      gmail_message_id: p.msg.id,
      from_name: p.from.name || null,
      from_email: p.from.email || null,
      participants: p.participants,
      sent_at: p.sentAt,
      body_text: p.parts.text || null,
      body_html: sanitizeEmailHtml(p.parts.html, { allowRemoteImages: false }).html || null,
      has_attachments: p.parts.attachments.length > 0,
      hidden_from_client: hidden.has(p.msg.id),
    }));
    const { data: saved, error: mErr } = await db.from('mail_messages')
      .upsert(rows, { onConflict: 'thread_id,gmail_message_id' })
      .select('id, gmail_message_id');
    if (mErr) return res.status(500).json({ error: mErr.message });
    const idByGmail = new Map((saved || []).map((r) => [r.gmail_message_id, r.id]));

    // ── Attachments → the job's Drive "Files Received" ──────────────────────
    // Filed against the FIRST job only. Copying the same survey into three
    // developer projects would be the app inventing duplicates in the firm's
    // Drive, which nobody asked for and nobody would clean up.
    const attachmentsSaved = [];
    const attachmentsSkipped = [];
    if (saveAttachments && hasDrive()) {
      const primaryJob = jobIds[0];
      const folderId = await resolveFilesReceivedFolderId(primaryJob).catch(() => null);
      if (!folderId) {
        attachmentsSkipped.push({
          reason: 'no_files_received_folder',
          job_id: primaryJob,
          detail: `No "Files Received" folder in Drive for ${primaryJob}.`,
        });
      } else {
        for (const p of parsed) {
          for (const att of p.parts.attachments) {
            try {
              const raw = await gmailGet(
                `/messages/${p.msg.id}/attachments/${att.attachmentId}`, token,
              );
              const bytes = Buffer.from(
                String(raw.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64',
              );
              const mime = effectiveMime(att.filename, att.mimeType);
              // Drive keeps same-named files side by side rather than
              // overwriting, so re-filing a thread can't clobber what is there.
              const up = await uploadToFolder(folderId, {
                name: att.filename, mimeType: mime, bytes,
              });
              await db.from('mail_attachments').insert({
                message_id: idByGmail.get(p.msg.id),
                filename: att.filename,
                mime_type: mime,
                size_bytes: att.size || bytes.length,
                drive_file_id: up?.id || null,
                drive_folder: 'Files Received',
                saved_at: new Date().toISOString(),
              });
              attachmentsSaved.push(att.filename);
            } catch (e) {
              attachmentsSkipped.push({ filename: att.filename, reason: e.message });
            }
          }
        }
      }
    }

    res.status(200).json({
      ok: true,
      threadId,
      jobs: jobIds,
      messages: rows.length,
      visibleToClient: Boolean(visibleToClient),
      hiddenFromClient: rows.filter((r) => r.hidden_from_client).length,
      attachmentsSaved,
      attachmentsSkipped,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(409).json({ error: 'google_reauth_needed' });
    }
    console.error('[api/inbox/file]', err);
    res.status(500).json({ error: err.message });
  }
}
