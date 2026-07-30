// Mail (/mail) — read the firm's work email inside the app.
//
// Replaces the dead end the Home widget was: it could show that a client had
// written and nothing more, so every actual question ("what did they say?",
// "did they attach the survey?") still meant leaving for Gmail.
//
// Reads the SIGNED-IN STAFFER'S OWN mailbox (never a shared one — Ang's call),
// on the gmail.readonly scope already granted. Threads, not messages: a
// five-reply exchange is one row, both halves of the conversation included.
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';
import {
  resolveCidImages, wrapEmailHtml, formatBytes, mailDate, canPreview, attachmentKind,
} from '../../lib/mail-html.js';

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

function MessageBody({ message, showImages, onShowImages }) {
  const [srcDoc, setSrcDoc] = useState(null);
  const [height, setHeight] = useState(160);
  const token = useId();

  // The frame measures itself and posts its height out (see wrapEmailHtml).
  // A sandboxed frame has an opaque origin, so messages arrive with origin
  // "null" — the per-message token is what authenticates them, not the origin.
  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data;
      if (!d || d.source !== 'rm117-mail' || d.token !== token) return;
      if (typeof d.height === 'number' && d.height > 0) {
        setHeight(Math.min(Math.max(d.height, 80), 20000));
      }
      if (typeof d.link === 'string' && /^https?:\/\//i.test(d.link)) {
        window.open(d.link, '_blank', 'noopener,noreferrer');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [token]);

  // Swap `cid:` refs for blob: URLs of the message's own inline parts.
  useEffect(() => {
    let alive = true;
    const made = [];
    (async () => {
      if (!message.html) { setSrcDoc(null); return; }
      let html = message.html;
      if (message.inline?.length) {
        const map = new Map();
        await Promise.all(message.inline.map(async (p) => {
          try {
            const r = await apiFetch(
              `/api/inbox/attachment?messageId=${encodeURIComponent(message.id)}`
              + `&attachmentId=${encodeURIComponent(p.attachmentId)}`
              + `&filename=${encodeURIComponent(p.filename)}`
              + `&mime=${encodeURIComponent(p.mimeType)}&inline=1`,
            );
            if (!r.ok) return;
            const u = URL.createObjectURL(await r.blob());
            made.push(u);
            map.set(p.contentId, u);
          } catch { /* a missing signature logo is not worth failing the body over */ }
        }));
        html = resolveCidImages(html, message.inline, (p) => map.get(p.contentId) || '');
      }
      if (!alive) return;
      setSrcDoc(wrapEmailHtml(html, token));
    })();
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [message.id, message.html, message.inline]);

  // Plain-text bodies render directly — no frame needed, and the height is
  // correct automatically. Most client mail lands here.
  if (!message.html) {
    return <pre className="mail-body-text">{message.text || <em>(no content)</em>}</pre>;
  }

  return (
    <div className="mail-body-wrap">
      {message.blockedImages > 0 && !showImages && (
        <div className="mail-images-blocked">
          <span>
            {message.blockedImages} remote image{message.blockedImages === 1 ? '' : 's'} blocked —
            they can tell the sender when you opened this.
          </span>
          <button type="button" className="btn btn-sm" onClick={onShowImages}>Show images</button>
        </div>
      )}
      {/* ⚠️ sandbox WITHOUT allow-same-origin — the frame gets an OPAQUE origin,
          so sender HTML cannot reach the app's DOM, cookies, storage or session.
          `allow-scripts` is present only so the frame can measure itself and
          report its height; no popup permission is granted, because links are
          posted out to the parent to open. The server-side sanitiser
          (api/_lib/gmail-read.js) still strips sender scripts as a second line
          of defence — do not remove one on the strength of the other. */}
      <iframe
        className="mail-body-frame"
        title="Message body"
        sandbox="allow-scripts"
        style={{ height: `${height}px` }}
        srcDoc={srcDoc || ''}
      />
    </div>
  );
}

function Message({ message, defaultOpen, expandAll }) {
  const [open, setOpen] = useState(defaultOpen);

  // "Expand all / Collapse all" from the thread header. Keyed on the counter so
  // pressing it twice in a row still applies after a manual toggle in between.
  useEffect(() => {
    if (expandAll?.n) setOpen(expandAll.value);
  }, [expandAll?.n, expandAll?.value]);
  const [showImages, setShowImages] = useState(false);
  const [previewAt, setPreviewAt] = useState(null);
  const who = message.from.name || message.from.email;

  // Only previewable attachments are steppable in the viewer — paging into a
  // .zip you can't render would be a dead end.
  const previewable = useMemo(
    () => message.attachments.filter((a) => canPreview(a.mimeType, a.filename)),
    [message.attachments],
  );

  return (
    <div className={`mail-msg${open ? ' is-open' : ''}`}>
      <button type="button" className="mail-msg-head" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        <span className="mail-chev" aria-hidden="true">›</span>
        <span className="mail-ava sm">{initials(who)}</span>
        <span className="mail-msg-who">
          <strong>{who}</strong>
          <span className="mail-msg-to">
            to {message.to.map((a) => a.name || a.email).join(', ') || '—'}
            {message.cc.length > 0 && ` · cc ${message.cc.map((a) => a.name || a.email).join(', ')}`}
          </span>
        </span>
        <span className="mail-msg-date">{mailDate(message.date)}</span>
      </button>

      {!open && <div className="mail-msg-peek">{message.snippet}</div>}

      {open && (
        <div className="mail-msg-body">
          <MessageBody
            message={message}
            showImages={showImages}
            onShowImages={() => setShowImages(true)}
          />
          {message.attachments.length > 0 && (
            <div className="mail-atts">
              <div className="mail-atts-label">
                {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
              </div>
              <div className="mail-atts-row">
                {message.attachments.map((a) => (
                  <Attachment
                    key={a.attachmentId}
                    att={a}
                    messageId={message.id}
                    onPreview={(att) => setPreviewAt(previewable.findIndex(
                      (p) => p.attachmentId === att.attachmentId,
                    ))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

// ------------------------------------------------------------------ the page

export default function Mail() {
  const clerk = useClerk();
  const [scope, setScope] = useState('work');
  const [list, setList] = useState({ status: 'loading' });
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState({ status: 'idle' });
  const [showImages, setShowImages] = useState(false);
  const [expandAll, setExpandAll] = useState({ value: false, n: 0 });

  useEffect(() => {
    let alive = true;
    setList({ status: 'loading' });
    (async () => {
      try {
        const r = await apiFetch(`/api/inbox?scope=${scope}&limit=60&days=30`, { cache: 'no-store' });
        const data = await r.json();
        if (!alive) return;
        if (!data.connected) setList({ status: 'disconnected', reason: data.reason });
        else setList({ status: 'ready', threads: data.threads || [], unreadCount: data.unreadCount || 0 });
      } catch {
        if (alive) setList({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [scope]);

  const openThread = useCallback(async (row, withImages = false) => {
    setOpenId(row.id);
    setThread({ status: 'loading' });
    setShowImages(withImages);
    setExpandAll({ value: false, n: 0 });
    try {
      const r = await apiFetch(
        `/api/inbox/thread?id=${encodeURIComponent(row.id)}${withImages ? '&images=1' : ''}`,
        { cache: 'no-store' },
      );
      const data = await r.json();
      if (data.connected === false) setThread({ status: 'disconnected', reason: data.reason });
      else if (!r.ok) setThread({ status: 'error' });
      else setThread({ status: 'ready', ...data.thread, row });
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
            Your own inbox — {list.status === 'ready' ? `${list.threads.length} conversations` : '…'}
            {list.status === 'ready' && list.unreadCount > 0 && ` · ${list.unreadCount} unread`}
          </div>
        </div>
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
            <div className="placeholder-note">No {scope === 'clients' ? 'client ' : ''}mail in the last 30 days.</div>
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
                <div className="mail-reader-actions">
                  {thread.messages.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setExpandAll((s) => ({ value: !s.value, n: s.n + 1 }))}
                    >
                      {expandAll.value ? 'Collapse all' : 'Expand all'}
                    </button>
                  )}
                  {!showImages && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => activeRow && openThread(activeRow, true)}
                    >
                      Load remote images
                    </button>
                  )}
                </div>
              </div>
              <div className="mail-msgs">
                {thread.messages.map((m, i) => (
                  <Message
                    key={m.id}
                    message={m}
                    defaultOpen={i === thread.messages.length - 1}
                    expandAll={expandAll}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
