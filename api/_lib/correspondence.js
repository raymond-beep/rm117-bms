// Per-job correspondence timeline — PURE (no db, no network, no Gmail token).
//
// This is the read side of filing. `api/inbox/file.js` copies the text of a filed
// thread into Supabase precisely so a colleague can read it WITHOUT access to the
// mailbox it arrived in — until this existed that copy was write-only, which made
// filing an act of faith.
//
// Two sources are merged because a job's client communication genuinely has two
// shapes and staff think of them as one history:
//   • filed Gmail threads   — the real conversation, whoever it was addressed to
//   • "Notify client" sends — what the firm told the client through the portal
// Keeping them in separate lists would make "what have we actually said to this
// client?" a question you answer by reading two screens and doing the sorting in
// your head, which is how things get said twice or not at all.
//
// ⚠️ Reads from the Supabase COPY, never from Gmail. That is the point: mail is
// per-mailbox, but the record of what belongs to a job is the firm's.

// Newest first. A missing date sorts last rather than crashing or claiming 1970 —
// `sent_at` is null for a message whose Date header we could not parse.
function byNewest(a, b) {
  const at = a.at ? Date.parse(a.at) : NaN;
  const bt = b.at ? Date.parse(b.at) : NaN;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;
  if (Number.isNaN(bt)) return -1;
  return bt - at;
}

// Build the timeline for one job.
//
//   threads       — mail_threads rows, each with `messages` (and each message its
//                   `attachments`), as nested by the correspondence endpoint
//   notifications — `notifications` rows for this job
//
// Returns [{ kind: 'thread' | 'notification', at, ... }] newest first.
export function buildTimeline({ threads = [], notifications = [] } = {}) {
  const entries = [];

  for (const t of threads) {
    // Within a thread, OLDEST first — a conversation reads top to bottom, the
    // opposite of the timeline it sits in.
    const messages = [...(t.messages || [])].sort((a, b) => {
      const at = a.sent_at ? Date.parse(a.sent_at) : NaN;
      const bt = b.sent_at ? Date.parse(b.sent_at) : NaN;
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return at - bt;
    });

    entries.push({
      kind: 'thread',
      id: t.id,
      at: t.last_message_at || messages[messages.length - 1]?.sent_at || t.filed_at || null,
      gmailThreadId: t.gmail_thread_id,
      subject: t.subject || '(no subject)',
      messageCount: t.message_count || messages.length,
      visibleToClient: Boolean(t.visible_to_client),
      filedAt: t.filed_at || null,
      // Every job this thread is filed against, so a developer's shared email is
      // visibly shared rather than looking like it belongs to this job alone.
      jobs: (t.mail_thread_jobs || []).map((r) => r.job_id).filter(Boolean),
      messages: messages.map((m) => ({
        id: m.id,
        from: m.from_name || m.from_email || 'unknown',
        fromEmail: m.from_email || '',
        at: m.sent_at || null,
        text: m.body_text || '',
        html: m.body_html || '',
        hiddenFromClient: Boolean(m.hidden_from_client),
        attachments: (m.attachments || m.mail_attachments || []).map((a) => ({
          filename: a.filename,
          mimeType: a.mime_type || null,
          size: a.size_bytes || null,
          driveFileId: a.drive_file_id || null,
        })),
      })),
    });
  }

  for (const n of notifications) {
    entries.push({
      kind: 'notification',
      id: n.id,
      at: n.sent_at || n.created_at || null,
      subject: n.subject || '(no subject)',
      body: n.body || '',
      toEmail: n.to_email || '',
      status: n.status || null,
      sentBy: n.sent_by || null,
      // A failed send is kept and flagged, never hidden: believing a client was
      // told something they were not is the expensive mistake here.
      failed: n.status === 'error' || Boolean(n.error),
      error: n.error || null,
    });
  }

  return entries.sort(byNewest);
}

// Resolve requested CONTACT IDS to the addresses they are allowed to reach.
//
// ⭐ THIS IS THE SECURITY BOUNDARY FOR COMPOSE, which is why it is a pure,
// separately-tested function rather than three lines inside the endpoint.
//
// A reply is safe because the server recomputes recipients from the message being
// answered — the UI may DROP an address but never add one. A new message has no
// such anchor, so if compose accepted addresses from the request body, any
// authenticated staff session could send mail as a real person at a real firm to
// anywhere. Instead the caller names contacts by ID and this maps them, so the
// reachable set is exactly "contacts already added to this client".
//
// Deactivated contacts are excluded: a project manager who left the developer must
// stop being emailable, the same rule that revokes their portal link on removal.
export function resolveRecipients(contacts = [], contactIds = []) {
  const wanted = new Set((contactIds || []).map((id) => String(id)));
  return (contacts || []).filter((c) => (
    c
    && wanted.has(String(c.id))
    && c.is_active !== false
    && Boolean(c.email)
  ));
}

// `Name <addr>` for each recipient, as a To: header value.
export function formatRecipients(contacts = []) {
  return contacts
    .map((c) => (c.name ? `${c.name} <${c.email}>` : c.email))
    .join(', ');
}

// One-line summary for the tab badge / job card.
export function summarize(timeline = []) {
  const threads = timeline.filter((e) => e.kind === 'thread');
  const notes = timeline.filter((e) => e.kind === 'notification');
  return {
    threads: threads.length,
    notifications: notes.length,
    shared: threads.filter((t) => t.visibleToClient).length,
    lastAt: timeline[0]?.at || null,
    failedNotifications: notes.filter((n) => n.failed).length,
  };
}
