// Correspondence tab — everything this job's client has said and been told.
//
// Replaces the old Messages tab, which was a per-job chat nobody ever used: it
// had 0 rows because it emailed nobody in either direction, so a client posting
// there was announced to no one. Rather than a fourth place to talk to a client,
// this shows the REAL history — Gmail threads a staffer filed against the job,
// plus the portal "Notify client" sends — in one timeline.
//
// ⭐ Reads the app's OWN copy (`/api/inbox/correspondence`), not Gmail. That is
// why this tab works for a colleague who was never on the email: the point of
// filing is that the conversation stops living in one person's mailbox.
//
// Read-only on purpose. Replying happens in the Mail tab, against the live
// thread, where the recipient list is derived from the actual message — there is
// no second send path to keep in step.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { splitQuotedText, countQuotedReplies } from '../../lib/mail-quote.js';

const fmt = (iso) => (iso
  ? new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  : 'date unknown');

const fmtSize = (n) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

function Attachment({ att }) {
  // Links to the file where the firm actually keeps it. No proxy: these already
  // live in the job's Drive folder, and a second copy served by the app would be
  // a second thing to keep in step.
  const href = att.driveFileId ? `https://drive.google.com/file/d/${att.driveFileId}/view` : null;
  const label = `${att.filename}${att.size ? ` · ${fmtSize(att.size)}` : ''}`;
  return href
    ? <a className="corr-att" href={href} target="_blank" rel="noreferrer">📎 {label}</a>
    // Filed before the Drive upload, or the upload failed — say so rather than
    // offering a link that goes nowhere.
    : <span className="corr-att is-missing" title="Not saved to Drive">📎 {label} · not in Drive</span>;
}

// The stored PLAIN TEXT, not the HTML. This is a record to read, not an inbox,
// and rendering sender HTML here would add a second sanitising surface for no gain.
//
// Quoted history and signatures are folded away, the same as the Mail tab and via
// the same tested helper. Every message in a filed thread repeats the whole
// conversation below it, so without this a five-reply thread shows the first email
// five times and the actual new words get lost in the `>` lines.
function MessageBody({ text }) {
  const [showQuoted, setShowQuoted] = useState(false);
  if (!text) return <div className="corr-msg-body"><em>No text captured.</em></div>;

  const { visible, quoted } = splitQuotedText(text);
  return (
    <>
      <div className="corr-msg-body">{visible || <em>No new text in this message.</em>}</div>
      {quoted && (
        <>
          <button type="button" className="corr-quoted-toggle" onClick={() => setShowQuoted((v) => !v)}>
            {showQuoted ? 'Hide' : `••• ${countQuotedReplies(quoted)} earlier ${countQuotedReplies(quoted) === 1 ? 'reply' : 'replies'} quoted`}
          </button>
          {showQuoted && <div className="corr-msg-body is-quoted">{quoted}</div>}
        </>
      )}
    </>
  );
}

function ThreadEntry({ entry, jobId }) {
  const [open, setOpen] = useState(false);
  const otherJobs = (entry.jobs || []).filter((j) => j !== jobId);

  return (
    <div className="corr-entry is-thread">
      <div className="corr-entry-head">
        <button type="button" className="corr-disclose" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'}
        </button>
        <div className="corr-entry-title">
          <strong>{entry.subject}</strong>
          <span className="corr-meta">
            {entry.messageCount} message{entry.messageCount === 1 ? '' : 's'} · {fmt(entry.at)}
          </span>
        </div>
        <div className="corr-badges">
          {entry.visibleToClient
            ? <span className="corr-badge is-shared" title="This client can read this thread in their portal">Shared with client</span>
            : <span className="corr-badge" title="Filed for the office only">Internal</span>}
        </div>
      </div>

      {/* A developer's email routinely covers several of their projects. Showing
          the other jobs stops this reading as if it belonged to this job alone. */}
      {otherJobs.length > 0 && (
        <div className="corr-alsofiled">
          Also filed against {otherJobs.map((j) => <code key={j}>{j}</code>)}
        </div>
      )}

      {open && (
        <div className="corr-messages">
          {entry.messages.map((m) => (
            <div key={m.id} className="corr-msg">
              <div className="corr-msg-head">
                <strong>{m.from}</strong>
                {m.fromEmail && m.fromEmail !== m.from && <span className="corr-msg-email">{m.fromEmail}</span>}
                <span className="corr-meta">{fmt(m.at)}</span>
                {/* Only meaningful once the thread is shared; otherwise every
                    message is internal and the flag would be noise. */}
                {entry.visibleToClient && m.hiddenFromClient && (
                  <span className="corr-badge is-hidden" title="Excluded from what the client sees">
                    Hidden from client
                  </span>
                )}
              </div>
              <MessageBody text={m.text} />
              {m.attachments.length > 0 && (
                <div className="corr-atts">
                  {m.attachments.map((a) => <Attachment key={a.filename + (a.driveFileId || '')} att={a} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationEntry({ entry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`corr-entry is-notify${entry.failed ? ' is-failed' : ''}`}>
      <div className="corr-entry-head">
        <button type="button" className="corr-disclose" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'}
        </button>
        <div className="corr-entry-title">
          <strong>{entry.subject}</strong>
          <span className="corr-meta">
            Update sent to {entry.toEmail || 'the client'} · {fmt(entry.at)}
          </span>
        </div>
        <div className="corr-badges">
          {entry.failed
            ? <span className="corr-badge is-failed" title={entry.error || 'Send failed'}>Failed to send</span>
            : <span className="corr-badge is-sent">Sent</span>}
        </div>
      </div>
      {open && (
        <div className="corr-messages">
          {/* Stored verbatim, so this answers "what exactly did we tell them". */}
          <div className="corr-msg">
            <div className="corr-msg-body">{entry.body || <em>No body recorded.</em>}</div>
            {entry.sentBy && <div className="corr-meta">Sent by {entry.sentBy}</div>}
            {entry.failed && entry.error && <div className="corr-error">Error: {entry.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Start a new conversation from the job.
//
// ⚠️ There is no free-text address field, on purpose. The server takes CONTACT IDS
// and resolves them against this client's `client_contacts` — see api/inbox/compose.js
// for why. A compose box that accepted typed addresses would turn any staff session
// into a relay sending as a real person at a real firm; a reply is safe only because
// its recipients are recomputed from the message being answered, and a new message
// has no such anchor. Adding a recipient is a deliberate act in the contacts UI.
function Compose({ job, onSent }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState(null);   // null = not loaded
  const [picked, setPicked] = useState(() => new Set());
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!open || contacts) return;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/client-contacts?client_id=${encodeURIComponent(job.client_id)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        setContacts((d.contacts || []).filter((c) => c.is_active !== false && c.email));
      } catch {
        setContacts([]);
      }
    })();
  }, [open, contacts, job.client_id, getToken]);

  // No client means no contact list to resolve against, so there is no safe
  // recipient set. Say why rather than showing a button that always fails.
  if (!job.client_id) {
    return (
      <div className="corr-compose-blocked">
        Link a client to this job to email about it — recipients come from the
        client’s contacts.
      </div>
    );
  }

  const send = async () => {
    if (state.status === 'sending') return;
    setState({ status: 'sending' });
    try {
      const token = await getToken();
      const r = await fetch('/api/inbox/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          jobId: job.job_id, contactIds: [...picked], subject, text,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setState({ status: 'error', message: d.error || 'Could not send.' }); return; }
      setState({ status: 'sent' });
      setSubject(''); setText(''); setPicked(new Set());
      setTimeout(() => { setOpen(false); setState({ status: 'idle' }); onSent?.(); }, 1200);
    } catch {
      setState({ status: 'error', message: 'Could not send.' });
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-sm corr-compose-open" onClick={() => setOpen(true)}>
        ✉ New email about this job
      </button>
    );
  }

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="corr-compose">
      <div className="corr-compose-head">
        <strong>New email</strong>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>

      <div className="corr-compose-to">
        <span className="mail-rcpt-label">To</span>
        {contacts === null && <span className="corr-meta">Loading contacts…</span>}
        {contacts?.length === 0 && (
          <span className="corr-meta">
            This client has no contacts yet — add one on the client record first.
          </span>
        )}
        {contacts?.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`mail-rcpt${picked.has(c.id) ? '' : ' is-off'}`}
            onClick={() => toggle(c.id)}
            title={c.email}
          >
            <span className="mail-rcpt-name">{c.name || c.email}</span>
            <span className="mail-rcpt-x" aria-hidden="true">{picked.has(c.id) ? '×' : '+'}</span>
          </button>
        ))}
      </div>

      <input
        className="corr-compose-subject"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="corr-compose-body"
        rows={5}
        placeholder="Write your message…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="corr-compose-foot">
        <span className="corr-meta">
          {state.status === 'error' && <span className="corr-error">{state.message}</span>}
          {state.status === 'sent' && 'Sent ✓ and filed against this job'}
          {state.status === 'idle' && 'Sends from your own Gmail · filed against this job'}
          {state.status === 'sending' && 'Sending…'}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!picked.size || !subject.trim() || !text.trim() || state.status === 'sending'}
          onClick={send}
        >
          {state.status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default function CorrespondenceTab({ job }) {
  const { getToken } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/inbox/correspondence?jobId=${encodeURIComponent(job.job_id)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (!alive) return;
        if (!r.ok) { setState({ status: 'error', message: d.error || 'Could not load correspondence.' }); return; }
        setState({ status: 'ready', ...d });
      } catch {
        if (alive) setState({ status: 'error', message: 'Could not load correspondence.' });
      }
    })();
    return () => { alive = false; };
  }, [job.job_id, getToken, reloadKey]);

  if (state.status === 'loading') {
    return <div className="drawer-body"><div className="placeholder-note">Loading correspondence…</div></div>;
  }
  if (state.status === 'error') {
    return <div className="drawer-body"><div className="placeholder-note">{state.message}</div></div>;
  }

  const { timeline = [], summary = {} } = state;

  return (
    <div className="drawer-body">
      <p className="hint" style={{ marginTop: 0 }}>
        Email filed against this job, plus every client update sent from the portal.
        {' '}File a thread from the <strong>Mail</strong> tab; reply there too, so the
        recipients come from the real message.
      </p>

      <Compose job={job} onSent={() => setReloadKey((k) => k + 1)} />

      {timeline.length === 0 ? (
        <div className="placeholder-note">
          Nothing filed yet. Open <strong>Mail</strong>, find the conversation, and use
          “File to job…” — the text is copied here so anyone can read it without
          access to that mailbox.
        </div>
      ) : (
        <>
          <div className="corr-summary">
            {summary.threads} thread{summary.threads === 1 ? '' : 's'}
            {summary.shared > 0 && <> · {summary.shared} shared with the client</>}
            {summary.notifications > 0 && <> · {summary.notifications} update{summary.notifications === 1 ? '' : 's'} sent</>}
            {summary.failedNotifications > 0 && (
              <span className="corr-summary-warn"> · {summary.failedNotifications} failed to send</span>
            )}
          </div>

          <div className="corr-timeline">
            {timeline.map((e) => (e.kind === 'thread'
              ? <ThreadEntry key={`t-${e.id}`} entry={e} jobId={job.job_id} />
              : <NotificationEntry key={`n-${e.id}`} entry={e} />))}
          </div>
        </>
      )}
    </div>
  );
}
