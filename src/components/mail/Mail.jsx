// Mail (/mail) — read the firm's work email inside the app.
//
// Replaces the dead end the Home widget was: it could show that a client had
// written and nothing more, so every actual question ("what did they say?",
// "did they attach the survey?") still meant leaving for Gmail.
//
// Reads the SIGNED-IN STAFFER'S OWN mailbox (never a shared one — Ang's call),
// on the gmail.readonly scope already granted. Threads, not messages: a
// five-reply exchange is one row, both halves of the conversation included.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';
import DOMPurify from 'dompurify';
import {
  resolveCidImages, formatBytes, mailDate, canPreview, attachmentKind, htmlHasContent,
} from '../../lib/mail-html.js';
import { splitQuotedHtml, splitQuotedText, countQuotedReplies } from '../../lib/mail-quote.js';
import { replyRecipients } from '../../lib/mail-html.js';
import { searchRecords } from '../../lib/search.js';

// Every link in an email opens in a new tab and never hands the opener over.
// Registered once, at module scope — addHook is global to the DOMPurify instance.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ('target' in node) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// What an email is allowed to be once it is inside our page.
//
// The message used to render in a sandboxed iframe, which was airtight but meant
// a separate document that could not flow with the page — its height had to be
// negotiated over postMessage, and that negotiation is what kept breaking. Now
// the body is sanitised and rendered inline, so it simply lays out like the rest
// of the page and there is no height to get wrong.
//
// ⚠️ Losing the iframe means losing the origin boundary, so the sanitiser is now
// the ONLY thing between sender HTML and this page — it must stay strict:
//   - script/iframe/object/embed/form: code execution and credential phishing.
//   - style/link: an email could otherwise restyle the whole app; inline `style`
//     attributes are still allowed, which is where email formatting really lives.
//   - The server-side pass (api/_lib/gmail-read.js) still runs first.
const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'applet', 'form', 'input',
    'button', 'textarea', 'select', 'style', 'link', 'meta', 'base', 'title'],
  FORBID_ATTR: ['srcset', 'ping', 'formaction'],
  ALLOW_DATA_ATTR: true,   // keeps data-blocked-src on images the server neutralised
  USE_PROFILES: { html: true },
};

// Build the app-proxied URL for one attachment. Everything goes through
// /api/inbox/attachment so the staffer's Google token never reaches the browser.
function attachmentUrl(messageId, att, inline = true) {
  return `/api/inbox/attachment?messageId=${encodeURIComponent(messageId)}`
    + `&attachmentId=${encodeURIComponent(att.attachmentId)}`
    + `&filename=${encodeURIComponent(att.filename)}`
    + `&mime=${encodeURIComponent(att.mimeType || '')}${inline ? '&inline=1' : ''}`;
}

// Fetch an attachment as a blob: URL. A bare <img src> or <iframe src> would
// arrive with no Authorization header and 401 — same reason ProposalDocs.jsx
// fetches signed proposals as blobs.
function useAttachmentBlob(messageId, att) {
  const [state, setState] = useState({ status: 'idle' });
  useEffect(() => {
    if (!att) { setState({ status: 'idle' }); return undefined; }
    let alive = true;
    let made = null;
    setState({ status: 'loading' });
    (async () => {
      try {
        const r = await apiFetch(attachmentUrl(messageId, att));
        if (!r.ok) throw new Error(`attachment ${r.status}`);
        const url = URL.createObjectURL(await r.blob());
        made = url;
        if (!alive) { URL.revokeObjectURL(url); return; }
        setState({ status: 'ready', url });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [messageId, att]);
  return state;
}

const SCOPES = [
  { key: 'work', label: 'Work', hint: 'Clients, colleagues, townships, engineers — newsletters and SaaS hidden' },
  { key: 'clients', label: 'Clients', hint: 'Only senders matched to a client record' },
  { key: 'all', label: 'All', hint: 'Everything, including bulk mail' },
];

function initials(name) {
  const parts = String(name || '').replace(/<.*>/, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const KIND_LABEL = { staff: 'Team', project: 'Project', noise: 'Bulk' };

// ---------------------------------------------------------------- thread list

function ThreadRow({ thread, active, onOpen }) {
  return (
    <button
      type="button"
      className={`mail-row${active ? ' is-active' : ''}${thread.unread ? ' is-unread' : ''}`}
      onClick={() => onOpen(thread)}
    >
      <span className={`mail-dot${thread.unread ? ' on' : ''}`} aria-hidden="true" />
      <span className="mail-ava">{initials(thread.from)}</span>
      <span className="mail-row-main">
        <span className="mail-row-top">
          <span className="mail-from">{thread.from}</span>
          {thread.messageCount > 1 && <span className="mail-count">{thread.messageCount}</span>}
          <span className="mail-date">{mailDate(thread.date)}</span>
        </span>
        <span className="mail-subj">{thread.subject}</span>
        <span className="mail-snip">{thread.snippet}</span>
        <span className="mail-tags">
          {thread.isClient && (
            <span className="mail-tag is-client" title={thread.clientLabel || ''}>
              {thread.clientLabel || 'Client'}
              {thread.contactName ? ` · ${thread.contactName}` : ''}
            </span>
          )}
          {!thread.isClient && KIND_LABEL[thread.kind] && (
            <span className={`mail-tag is-${thread.kind}`}>{KIND_LABEL[thread.kind]}</span>
          )}
          {thread.jobs.slice(0, 3).map((j) => (
            <span key={j} className="mail-tag is-job">{j}</span>
          ))}
          {thread.jobs.length > 3 && <span className="mail-tag is-job">+{thread.jobs.length - 3}</span>}
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------- one message

const KIND_ICON = { pdf: '▤', image: '▣', other: '◈' };

function Attachment({ att, messageId, onPreview }) {
  const [busy, setBusy] = useState(false);
  const kind = attachmentKind(att.filename, att.mimeType);

  const download = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(attachmentUrl(messageId, att, false));
      if (!r.ok) throw new Error(`attachment ${r.status}`);
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch {
      alert(`Couldn’t download ${att.filename}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`mail-att is-${kind}`}>
      <span className="mail-att-icon" aria-hidden="true">{KIND_ICON[kind]}</span>
      <span className="mail-att-meta">
        <span className="mail-att-name" title={att.filename}>{att.filename}</span>
        <span className="mail-att-size">{formatBytes(att.size)}</span>
      </span>
      {canPreview(att.mimeType, att.filename) && (
        <button type="button" className="btn btn-sm" onClick={() => onPreview(att)}>View</button>
      )}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={download}>Download</button>
    </span>
  );
}

// Full-screen viewer for a PDF or image attachment, in the app.
//
// Drawing sets arrive as a pile of PDFs — the message that prompted this had
// seven — so it steps through them with ← / → rather than making you close and
// reopen. PDFs use the browser's own PDF viewer inside the frame (zoom, page
// nav, print all come free); images render directly.
function AttachmentPreview({ items, index, messageId, onClose, onIndex }) {
  const att = items[index];
  const blob = useAttachmentBlob(messageId, att);
  const kind = attachmentKind(att?.filename, att?.mimeType);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!att) return null;

  return (
    <div className="mail-viewer" role="dialog" aria-modal="true" aria-label={att.filename}>
      <div className="mail-viewer-bar">
        <div className="mail-viewer-title">
          <strong title={att.filename}>{att.filename}</strong>
          <span className="mail-viewer-sub">
            {formatBytes(att.size)}
            {items.length > 1 && ` · ${index + 1} of ${items.length}`}
          </span>
        </div>
        <div className="mail-viewer-actions">
          {items.length > 1 && (
            <>
              <button type="button" className="btn btn-sm" disabled={index === 0}
                onClick={() => onIndex(index - 1)}>‹ Prev</button>
              <button type="button" className="btn btn-sm" disabled={index === items.length - 1}
                onClick={() => onIndex(index + 1)}>Next ›</button>
            </>
          )}
          {blob.status === 'ready' && (
            <>
              <a className="btn btn-sm" href={blob.url} target="_blank" rel="noreferrer">New tab</a>
              <a className="btn btn-sm" href={blob.url} download={att.filename}>Download</a>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>Close ✕</button>
        </div>
      </div>
      <div className="mail-viewer-body">
        {blob.status === 'loading' && <div className="placeholder-note">Loading {att.filename}…</div>}
        {blob.status === 'error' && <div className="placeholder-note">Couldn’t open this attachment.</div>}
        {blob.status === 'ready' && kind === 'image' && (
          <img className="mail-viewer-img" src={blob.url} alt={att.filename} />
        )}
        {blob.status === 'ready' && kind === 'pdf' && (
          <iframe className="mail-viewer-frame" title={att.filename} src={blob.url} />
        )}
      </div>
    </div>
  );
}

// The firm's own side of the conversation. Domain, not the signed-in user: what
// matters when reading a thread is "us" versus "the client", so a colleague's
// reply belongs on the same side as your own.
const STAFF_DOMAIN = '@rm117.com';
const isOurs = (message) => String(message?.from?.email || '').endsWith(STAFF_DOMAIN);

function MessageBody({ message, showImages, onShowImages }) {
  const [parts, setParts] = useState({ visible: '', quoted: '' });
  const [showQuoted, setShowQuoted] = useState(false);

  // Resolve `cid:` inline images to blob: URLs, sanitise, then split the quoted
  // history off the part that was actually written.
  useEffect(() => {
    let alive = true;
    const made = [];
    (async () => {
      if (!message.html) { setParts({ visible: '', quoted: '' }); return; }
      let raw = message.html;
      if (message.inline?.length) {
        const map = new Map();
        await Promise.all(message.inline.map(async (p) => {
          try {
            const r = await apiFetch(attachmentUrl(message.id, p));
            if (!r.ok) return;
            const u = URL.createObjectURL(await r.blob());
            made.push(u);
            map.set(p.contentId, u);
          } catch { /* a missing signature logo is not worth failing the body over */ }
        }));
        raw = resolveCidImages(raw, message.inline, (p) => map.get(p.contentId) || '');
      }
      if (!alive) return;
      setParts(splitQuotedHtml(DOMPurify.sanitize(raw, PURIFY_CONFIG)));
    })();
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [message.id, message.html, message.inline]);

  // Plain text: same split, no sanitising needed.
  if (!htmlHasContent(message.html)) {
    const { visible, quoted } = splitQuotedText(message.text || message.snippet);
    return (
      <>
        <pre className="mail-body-text">
          {visible || <em>(this message has no readable body)</em>}
        </pre>
        {quoted && (
          <QuotedToggle
            open={showQuoted}
            count={countQuotedReplies(quoted)}
            onToggle={() => setShowQuoted((v) => !v)}
          >
            <pre className="mail-body-text is-quoted">{quoted}</pre>
          </QuotedToggle>
        )}
      </>
    );
  }

  return (
    <>
      {message.blockedImages > 0 && !showImages && (
        <div className="mail-images-blocked">
          <span>
            {message.blockedImages} remote image{message.blockedImages === 1 ? '' : 's'} blocked
          </span>
          <button type="button" className="btn btn-sm" onClick={onShowImages}>Show</button>
        </div>
      )}
      <div className="mail-body-html" dangerouslySetInnerHTML={{ __html: parts.visible }} />
      {parts.quoted && (
        <QuotedToggle
          open={showQuoted}
          count={countQuotedReplies(parts.quoted)}
          onToggle={() => setShowQuoted((v) => !v)}
        >
          <div className="mail-body-html is-quoted" dangerouslySetInnerHTML={{ __html: parts.quoted }} />
        </QuotedToggle>
      )}
    </>
  );
}

// The "•••" every mail client uses. Nothing is deleted — occasionally the quoted
// chain holds something never restated, and losing it would mean opening Gmail.
function QuotedToggle({ open, count, onToggle, children }) {
  return (
    <div className="mail-quoted">
      <button type="button" className="mail-quoted-btn" onClick={onToggle} aria-expanded={open}>
        <span className="mail-dots">•••</span>
        {open
          ? 'Hide quoted text'
          : `${count} earlier ${count === 1 ? 'reply' : 'replies'} quoted`}
      </button>
      {open && children}
    </div>
  );
}

function Bubble({ message }) {
  const [showImages, setShowImages] = useState(false);
  const [previewAt, setPreviewAt] = useState(null);
  const mine = isOurs(message);
  const who = message.from.name || message.from.email;

  const previewable = useMemo(
    () => message.attachments.filter((a) => canPreview(a.mimeType, a.filename)),
    [message.attachments],
  );

  return (
    <div className={`mail-turn${mine ? ' is-mine' : ''}`}>
      <div className="mail-bubble">
        <MessageBody
          message={message}
          showImages={showImages}
          onShowImages={() => setShowImages(true)}
        />
      </div>

      {message.attachments.length > 0 && (
        <div className="mail-atts-row">
          {message.attachments.map((a) => (
            <Attachment
              key={a.attachmentId}
              att={a}
              messageId={message.id}
              onPreview={(att) => setPreviewAt(
                previewable.findIndex((p) => p.attachmentId === att.attachmentId),
              )}
            />
          ))}
        </div>
      )}

      <div className="mail-turn-meta">
        {mine ? who : who}
        {message.cc.length > 0 && <span className="mail-turn-cc"> · cc {message.cc.length}</span>}
        {' · '}{mailDate(message.date)}
      </div>

      {previewAt !== null && previewAt >= 0 && (
        <AttachmentPreview
          items={previewable}
          index={previewAt}
          messageId={message.id}
          onIndex={setPreviewAt}
          onClose={() => setPreviewAt(null)}
        />
      )}
    </div>
  );
}

// Reply box, pinned under the conversation.
//
// ⚠️ The recipient list shown here is a PREVIEW. The server recomputes it from
// the thread and will not accept a wider one — a reply-all on a developer's
// thread reaches their whole team, so who gets mailed is not the browser's call.
function ReplyBox({ thread, selfEmail, onSent }) {
  const last = thread.messages[thread.messages.length - 1];
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const [state, setState] = useState({ status: 'idle' });

  const [dropped, setDropped] = useState(() => new Set());

  const { to, cc } = useMemo(
    () => replyRecipients(last, selfEmail, { all }),
    [last, selfEmail, all],
  );

  // Turning reply-all off and on again should not silently keep people removed.
  useEffect(() => { setDropped(new Set()); }, [all, last.id]);

  const toggleDrop = (email) => setDropped((prev) => {
    const next = new Set(prev);
    if (next.has(email)) next.delete(email); else next.add(email);
    return next;
  });

  const liveCount = [...to, ...cc].filter((a) => !dropped.has(a.email)).length;

  const send = async () => {
    if (!text.trim() || state.status === 'sending') return;
    setState({ status: 'sending' });
    try {
      const r = await apiFetch('/api/inbox/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id, messageId: last.id, text, replyAll: all,
          drop: [...dropped],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setState({ status: 'error', message: data.error || 'Could not send.' });
        return;
      }
      setText('');
      setState({ status: 'sent' });
      onSent?.();
      setTimeout(() => setState({ status: 'idle' }), 2500);
    } catch {
      setState({ status: 'error', message: 'Could not send.' });
    }
  };

  // ⚠️ Every recipient is listed in full, never truncated. On a developer's
  // thread this is the last chance to see that a reply-all reaches their whole
  // team, and "Gabe …" cut off mid-name is exactly where that gets missed.
  const chip = (a, kind) => {
    const off = dropped.has(a.email);
    return (
      <button
        key={`${kind}-${a.email}`}
        type="button"
        className={`mail-rcpt is-${kind}${off ? ' is-off' : ''}`}
        title={off ? `${a.email} — removed, click to add back` : `${a.email} — click to remove`}
        onClick={() => toggleDrop(a.email)}
      >
        <span className="mail-rcpt-name">{a.name || a.email}</span>
        <span className="mail-rcpt-x" aria-hidden="true">{off ? '+' : '×'}</span>
      </button>
    );
  };

  return (
    <div className="mail-reply">
      <div className="mail-reply-head">
        <span className="mail-reply-count">
          {liveCount} recipient{liveCount === 1 ? '' : 's'}
        </span>
        {(last.to.length + last.cc.length) > 1 && (
          <label className="mail-reply-all">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Reply all
          </label>
        )}
      </div>

      <div className="mail-rcpts">
        <span className="mail-rcpt-label">To</span>
        {to.length ? to.map((a) => chip(a, 'to')) : <span className="mail-rcpt-none">—</span>}
        {cc.length > 0 && (
          <>
            <span className="mail-rcpt-label">Cc</span>
            {cc.map((a) => chip(a, 'cc'))}
          </>
        )}
      </div>
      <textarea
        className="mail-reply-input"
        placeholder={`Reply to ${last.from.name || last.from.email}…`}
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter sends; plain Enter must stay a newline, or half-written
          // replies go out to clients.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
        }}
      />
      <div className="mail-reply-foot">
        <span className="mail-reply-note">
          {state.status === 'error' && <span className="mail-reply-err">{state.message}</span>}
          {state.status === 'sent' && <span className="mail-reply-ok">Sent ✓</span>}
          {state.status === 'idle' && 'Sends from your own Gmail · ⌘↵'}
          {state.status === 'sending' && 'Sending…'}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!text.trim() || !liveCount || state.status === 'sending'}
          onClick={send}
        >
          {state.status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// "File to job" — the step that ties an email to the work.
//
// ⚠️ The job list is SUGGESTED, never applied on its own. The suggestion comes
// from the client match (sender → client → their jobs), which is right often
// enough to be useful and wrong often enough that it must not decide: "Deuel"
// names five different projects. A person confirms before anything is filed —
// the same rule the Drive → app sync runs on, where a wrong link is worse than
// no link.
//
// ⚠️ …which is why NOTHING starts ticked. The suggestions used to come
// pre-selected, which made "a person confirms" a rubber stamp: the fastest path
// through the dialog accepted all of them. On a real thread — DaSilva's "235
// Munsee Way Rev 3" — that meant filing it against four DaSilva jobs and, since
// attachments go to the FIRST job only, uploading the Munsee drawings into
// Florham Park's Drive folder. Suggestions are still listed and still one click
// each; they just no longer decide by default. Jobs ALREADY filed do start
// ticked — that is recorded state, not a guess.
function FileToJob({ thread, row, onFiled }) {
  const [open, setOpen] = useState(false);
  const [filed, setFiled] = useState(null);      // null = not loaded yet
  const [picked, setPicked] = useState(() => new Set());
  const [jobs, setJobs] = useState([]);
  const [query, setQuery] = useState('');
  const [saveAttachments, setSaveAttachments] = useState(true);
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [preview, setPreview] = useState({ status: 'idle' });
  const [hidden, setHidden] = useState(() => new Set());
  const [state, setState] = useState({ status: 'idle' });

  // What is already filed for this thread?
  useEffect(() => {
    let alive = true;
    setFiled(null);
    apiFetch(`/api/inbox/file?threadId=${encodeURIComponent(thread.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setFiled(d.filed ? d : { filed: false, jobs: [] });
        if (d.filed) {
          // Already filed: these are the jobs of record, so they stay ticked.
          setPicked(new Set(d.jobs || []));
          setVisibleToClient(Boolean(d.thread?.visible_to_client));
        } else {
          setPicked(new Set());
        }
      })
      .catch(() => { if (alive) setFiled({ filed: false, jobs: [] }); });
    return () => { alive = false; };
  }, [thread.id, row?.jobs]);

  // Jobs are only fetched when the panel opens — the Mail page has no other
  // reason to pull 160 of them.
  useEffect(() => {
    if (!open || jobs.length) return;
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => setJobs(Array.isArray(d) ? d : (d.jobs || [])))
      .catch(() => {});
  }, [open, jobs.length]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // No query: offer the suggested jobs plus anything already picked.
      const ids = new Set([...(row?.jobs || []), ...picked]);
      return jobs.filter((j) => ids.has(j.job_id));
    }
    const hits = searchRecords(query, jobs, [], 12).filter((h) => h.kind === 'job');
    return hits.map((h) => jobs.find((j) => j.job_id === h.id)).filter(Boolean);
  }, [query, jobs, row?.jobs, picked]);

  // ⚠️ Ticking "visible to the client" LOADS THE PREVIEW immediately — you
  // cannot turn sharing on without the actual conversation in front of you.
  // That is the whole safety model for showing a whole thread: not a filter, a
  // person looking first. Same shape as portal/draft, which composes the client
  // update email and sends nothing so the confirm dialog can show the real one.
  useEffect(() => {
    if (!visibleToClient || !picked.size) { setPreview({ status: 'idle' }); return undefined; }
    let alive = true;
    setPreview({ status: 'loading' });
    const job = [...picked][0];
    apiFetch(`/api/inbox/share-preview?threadId=${encodeURIComponent(thread.id)}`
      + `&jobId=${encodeURIComponent(job)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setPreview(d.error ? { status: 'error', message: d.error } : { status: 'ready', ...d }); })
      .catch(() => { if (alive) setPreview({ status: 'error', message: 'Could not build the preview.' }); });
    return () => { alive = false; };
  }, [visibleToClient, picked, thread.id]);

  const toggleHidden = (id) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggle = (jobId) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
    return next;
  });

  const file = async () => {
    if (!picked.size) return;
    setState({ status: 'saving' });
    try {
      const r = await apiFetch('/api/inbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          jobIds: [...picked],
          saveAttachments,
          visibleToClient,
          hiddenMessageIds: visibleToClient ? [...hidden] : [],
        }),
      });
      const d = await r.json();
      if (!r.ok) { setState({ status: 'error', message: d.error || 'Could not file.' }); return; }
      setState({ status: 'done', result: d });
      setFiled({ filed: true, jobs: [...picked], thread: { visible_to_client: visibleToClient } });
      setOpen(false);
      onFiled?.(d);
    } catch {
      setState({ status: 'error', message: 'Could not file.' });
    }
  };

  const unfile = async () => {
    setState({ status: 'saving' });
    try {
      await apiFetch(`/api/inbox/file?threadId=${encodeURIComponent(thread.id)}`, { method: 'DELETE' });
      setFiled({ filed: false, jobs: [] });
      setPicked(new Set(row?.jobs || []));
      setState({ status: 'idle' });
    } catch {
      setState({ status: 'error', message: 'Could not unfile.' });
    }
  };

  const isFiled = filed?.filed;

  return (
    <div className="mail-file">
      <div className="mail-file-bar">
        {isFiled ? (
          <>
            <span className="mail-filed-badge">✓ Filed</span>
            {(filed.jobs || []).map((j) => <span key={j} className="mail-tag is-job">{j}</span>)}
            {filed.thread?.visible_to_client && (
              <span className="mail-tag is-shared" title="This client can see the messages they were on">
                Shared with client
              </span>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>Edit</button>
            <button type="button" className="btn btn-sm" onClick={unfile}>Unfile</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
              File to job…
            </button>
            {(row?.jobs || []).length > 0 && (
              <span className="mail-file-hint">
                Suggested: {(row.jobs || []).join(', ')}
              </span>
            )}
          </>
        )}
        {state.status === 'error' && <span className="mail-reply-err">{state.message}</span>}
        {state.status === 'done' && state.result && (
          <span className="mail-reply-ok">
            Filed{state.result.attachmentsSaved?.length
              ? ` · ${state.result.attachmentsSaved.length} file(s) → Drive`
              : ''}
          </span>
        )}
      </div>

      {state.status === 'done' && state.result?.attachmentsSkipped?.length > 0 && (
        <div className="mail-file-warn">
          {state.result.attachmentsSkipped.map((s, i) => (
            <div key={i}>
              {s.filename ? `${s.filename}: ` : ''}
              {s.reason === 'no_files_received_folder'
                ? `${s.detail} Create it in Drive and file again to save the attachments.`
                : s.reason}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mail-file-panel">
          <input
            className="mail-file-search"
            placeholder="Search jobs by Job ID or client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="mail-file-results">
            {results.length === 0 && (
              <div className="mail-file-empty">
                {query.trim() ? 'No matching jobs.' : 'Search for a job to file this against.'}
              </div>
            )}
            {results.map((j) => (
              <label key={j.job_id} className="mail-file-job">
                <input
                  type="checkbox"
                  checked={picked.has(j.job_id)}
                  onChange={() => toggle(j.job_id)}
                />
                <span className="mail-file-jobid">{j.job_id}</span>
                <span className="mail-file-jobname">{j.client_name || j.address || ''}</span>
              </label>
            ))}
          </div>

          <label className="mail-file-opt">
            <input
              type="checkbox"
              checked={saveAttachments}
              onChange={(e) => setSaveAttachments(e.target.checked)}
            />
            Save attachments to the job&rsquo;s Drive &ldquo;Files Received&rdquo;
          </label>
          <label className="mail-file-opt">
            <input
              type="checkbox"
              checked={visibleToClient}
              onChange={(e) => setVisibleToClient(e.target.checked)}
            />
            Visible to the client in their portal
            <span className="mail-file-sub">
              They only ever see messages they were personally on.
            </span>
          </label>

          {visibleToClient && (
            <div className="mail-share-preview">
              {preview.status === 'loading' && (
                <div className="mail-file-empty">Building the client&rsquo;s view…</div>
              )}
              {preview.status === 'error' && (
                <div className="mail-reply-err">{preview.message}</div>
              )}
              {preview.status === 'ready' && (
                <>
                  <div className="mail-share-head">
                    <strong>What {preview.client?.name || 'the client'} will see</strong>
                    <span>
                      {preview.messageCount - hidden.size} of {preview.messageCount} messages
                    </span>
                  </div>

                  {preview.unknownClient && (
                    <div className="mail-share-warn">
                      This job has no client linked, so nobody can be told what is new to
                      them. Link a client before sharing.
                    </div>
                  )}

                  {!preview.unknownClient && preview.notOnCount > 0 && (
                    <div className="mail-share-warn">
                      <strong>{preview.notOnCount}</strong> of these messages{' '}
                      {preview.notOnCount === 1 ? 'was' : 'were'} never sent to{' '}
                      {preview.client?.name || 'this client'} — internal replies, or other
                      parties. Sharing shows {preview.notOnCount === 1 ? 'it' : 'them'} for the
                      first time.
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setHidden(new Set(
                          preview.messages.filter((m) => !m.clientWasOn).map((m) => m.id),
                        ))}
                      >
                        Exclude those {preview.notOnCount}
                      </button>
                    </div>
                  )}

                  <div className="mail-share-list">
                    {preview.messages.map((m) => {
                      const off = hidden.has(m.id);
                      return (
                        <label key={m.id} className={`mail-share-msg${off ? ' is-off' : ''}${m.clientWasOn ? '' : ' is-new'}`}>
                          <input type="checkbox" checked={!off} onChange={() => toggleHidden(m.id)} />
                          <span className="mail-share-msg-main">
                            <span className="mail-share-msg-top">
                              <strong>{m.from.name || m.from.email}</strong>
                              {!m.clientWasOn && (
                                <span className="mail-share-flag">not sent to them</span>
                              )}
                              <span className="mail-share-date">{mailDate(m.date)}</span>
                            </span>
                            <span className="mail-share-snip">{m.snippet}</span>
                            {m.attachments.length > 0 && (
                              <span className="mail-share-atts">
                                {m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mail-file-actions">
            <span className="mail-file-count">
              {picked.size} job{picked.size === 1 ? '' : 's'} selected
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn"
              disabled={
                !picked.size || state.status === 'saving'
                || (visibleToClient && (preview.status === 'loading' || preview.unknownClient))
              }
              onClick={file}
            >
              {state.status === 'saving' ? 'Filing…' : isFiled ? 'Update' : 'File'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the page

export default function Mail() {
  const clerk = useClerk();
  const { user } = useUser();
  const selfEmail = user?.primaryEmailAddress?.emailAddress || '';
  const [scope, setScope] = useState('work');
  const [list, setList] = useState({ status: 'loading' });
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState({ status: 'idle' });
  const [showImages, setShowImages] = useState(false);
  // Two pieces of search state on purpose. `term` is what's being typed; `query` is what has
  // actually been submitted and fetched. Search runs on Enter, NOT on every keystroke — each
  // run costs a Gmail list plus a bounded per-message fan-out (see mapGmail), and typing
  // "Costello" as-you-type would fire eight of those and start tripping Gmail's per-user
  // concurrency limit for no benefit.
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    setList({ status: 'loading' });
    (async () => {
      try {
        // Searching ignores the scope tabs and the 30-day window server-side; sending them
        // anyway would imply otherwise to anyone reading the network tab.
        const url = query
          ? `/api/inbox?q=${encodeURIComponent(query)}&limit=60`
          : `/api/inbox?scope=${scope}&limit=60&days=30`;
        const r = await apiFetch(url, { cache: 'no-store' });
        const data = await r.json();
        if (!alive) return;
        if (!data.connected) setList({ status: 'disconnected', reason: data.reason });
        else setList({ status: 'ready', threads: data.threads || [], unreadCount: data.unreadCount || 0 });
      } catch {
        if (alive) setList({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [scope, query]);

  // Submitting closes whatever thread was open — it belonged to the previous list.
  const runSearch = (e) => {
    e.preventDefault();
    setOpenId(null); setThread({ status: 'idle' });
    setQuery(term.trim());
  };
  const clearSearch = () => {
    setOpenId(null); setThread({ status: 'idle' });
    setTerm(''); setQuery('');
  };

  const openThread = useCallback(async (row, withImages = false) => {
    setOpenId(row.id);
    setThread({ status: 'loading' });
    setShowImages(withImages);
    try {
      const r = await apiFetch(
        `/api/inbox/thread?id=${encodeURIComponent(row.id)}${withImages ? '&images=1' : ''}`,
        { cache: 'no-store' },
      );
      const data = await r.json();
      if (data.connected === false) setThread({ status: 'disconnected', reason: data.reason });
      else if (!r.ok) setThread({ status: 'error' });
      else {
        setThread({ status: 'ready', ...data.thread, row });
        // Best effort: needs gmail.modify. Until every staffer has re-consented
        // this returns ok:false and unread stays display-only — reading still
        // worked, so it must never surface as an error.
        if (row.unread) {
          apiFetch('/api/inbox/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threadId: row.id }),
          })
            .then((mr) => mr.json())
            .then((mres) => {
              if (!mres?.ok) return;
              setList((prev) => (prev.status === 'ready' ? {
                ...prev,
                threads: prev.threads.map((t) => (t.id === row.id ? { ...t, unread: false } : t)),
                unreadCount: Math.max(0, prev.unreadCount - 1),
              } : prev));
            })
            .catch(() => {});
        }
      }
    } catch {
      setThread({ status: 'error' });
    }
  }, []);

  const activeRow = useMemo(
    () => (list.threads || []).find((t) => t.id === openId) || null,
    [list.threads, openId],
  );

  return (
    <div className="page mail-page">
      <div className="page-head">
        <div>
          <h2>Mail</h2>
          <div className="page-sub">
            {query ? (
              list.status === 'ready'
                ? `${list.threads.length} result${list.threads.length === 1 ? '' : 's'} for “${query}” — all mail, any date`
                : `Searching all mail for “${query}”…`
            ) : (
              <>
                Your own inbox — {list.status === 'ready' ? `${list.threads.length} conversations` : '…'}
                {list.status === 'ready' && list.unreadCount > 0 && ` · ${list.unreadCount} unread`}
              </>
            )}
          </div>
        </div>
        <div className="mail-head-tools">
          <form className="mail-search" onSubmit={runSearch} role="search">
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search all mail…"
              aria-label="Search mail"
            />
            <button type="submit" className="mail-search-go" disabled={!term.trim()}>Search</button>
            {query && (
              <button type="button" className="mail-search-clear" onClick={clearSearch}>Clear</button>
            )}
          </form>
          {/* Scope is a browsing filter and does not apply to results, so it is hidden rather
              than left visible-but-inert — a lit "Work" tab beside search results would read
              as "these results are filtered", which is exactly what they are not. */}
          {!query && (
            <div className="mail-scopes" role="tablist">
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={scope === s.key}
                  title={s.hint}
                  className={`mail-scope${scope === s.key ? ' is-on' : ''}`}
                  onClick={() => setScope(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mail-split">
        <div className="mail-list card">
          {list.status === 'loading' && <div className="placeholder-note">Loading your mail…</div>}
          {list.status === 'error' && (
            <div className="placeholder-note">Couldn’t load your mail right now. Try refreshing.</div>
          )}
          {list.status === 'disconnected' && (
            <div className="placeholder-note">
              {list.reason === 'clerk_not_configured'
                ? 'Gmail isn’t configured yet.'
                : 'Connect your Google account (read-only Gmail) to see your mail here.'}
              {list.reason !== 'clerk_not_configured' && (
                <>
                  <div style={{ marginTop: 10 }}>
                    <button className="btn" onClick={() => clerk.openUserProfile()}>Connect Google</button>
                  </div>
                  <div className="inbox-connect-hint">
                    Make sure to grant Gmail &amp; Calendar access. If you skipped it when you
                    signed in, sign out and back in and select those features.
                  </div>
                </>
              )}
            </div>
          )}
          {list.status === 'ready' && list.threads.length === 0 && (
            query ? (
              <div className="placeholder-note">
                Nothing matched “{query}”.
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Gmail’s own search terms work here — <code>from:gabe</code>,{' '}
                  <code>has:attachment</code>, or <code>&quot;an exact phrase&quot;</code>.
                </div>
              </div>
            ) : (
              <div className="placeholder-note">No {scope === 'clients' ? 'client ' : ''}mail in the last 30 days.</div>
            )
          )}
          {list.status === 'ready' && list.threads.map((t) => (
            <ThreadRow key={t.id} thread={t} active={t.id === openId} onOpen={openThread} />
          ))}
        </div>

        <div className="mail-reader card">
          {!openId && (
            <div className="placeholder-note mail-empty">
              Pick a conversation to read it here — full message, both sides, with attachments.
            </div>
          )}
          {openId && thread.status === 'loading' && <div className="placeholder-note">Opening…</div>}
          {openId && thread.status === 'error' && (
            <div className="placeholder-note">Couldn’t open that conversation.</div>
          )}
          {openId && thread.status === 'ready' && (
            <>
              <div className="mail-reader-head">
                <h3>{thread.subject}</h3>
                <div className="mail-tags">
                  {activeRow?.isClient && (
                    <span className="mail-tag is-client">{activeRow.clientLabel || 'Client'}</span>
                  )}
                  {(activeRow?.jobs || []).map((j) => (
                    <span key={j} className="mail-tag is-job">{j}</span>
                  ))}
                  <span className="mail-msgcount">
                    {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
                  </span>
                </div>
                <FileToJob thread={thread} row={activeRow} />
                {!showImages && (
                  <div className="mail-reader-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => activeRow && openThread(activeRow, true)}
                    >
                      Load remote images
                    </button>
                  </div>
                )}
              </div>
              <div className="mail-msgs">
                {thread.messages.map((m) => <Bubble key={m.id} message={m} />)}
              </div>
              <ReplyBox
                thread={thread}
                selfEmail={selfEmail}
                onSent={() => activeRow && openThread(activeRow, showImages)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
