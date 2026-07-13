// "Notify client" — compose, REVIEW, then send an update email from the staffer's own Gmail.
//
// The review step is the point. An email to a client cannot be recalled, so nothing is sent
// until a person has read the exact words on screen and pressed Send. The draft is fetched
// from the server (`/api/portal/draft`) rather than assembled here, so what's shown is what
// the server will send — a preview that can drift from the real thing is worse than none.
//
// Drafting has NO side effects: the magic link is minted at the moment of sending, so
// opening this dialog and closing it again leaves nothing behind.
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function NotifyClientModal({ job, onClose, onSent }) {
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | sending | sent | error
  const [error, setError] = useState(null);
  // Who this send goes to. Everyone attached to the client is ticked by default; a staffer can
  // drop someone for THIS send without removing them from the project.
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);

  const load = useCallback(async (n) => {
    setStatus('loading');
    setError(null);
    try {
      const r = await apiFetch(
        `/api/portal/draft?job_id=${encodeURIComponent(job.job_id)}&note=${encodeURIComponent(n || '')}`,
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not prepare the email');
      setDraft(d);
      // Don't clobber wording the staffer has already edited.
      if (!edited) { setSubject(d.subject); setText(d.text); }
      // Default: notify everyone attached to the client.
      setPicked((prev) => prev ?? (d.recipients || []).map((r) => r.id));
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, [job.job_id, edited]);

  useEffect(() => { load(''); }, [load]);

  async function send() {
    setStatus('sending');
    setError(null);
    try {
      const r = await apiFetch('/api/portal/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, note, subject, text, contact_ids: picked }),
      });
      const d = await r.json();
      if (!r.ok) { const e = new Error(d.error || 'Send failed'); e.code = d.code; throw e; }
      setResult(d);
      setStatus('sent');
      onSent?.(d);
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  const canSend = status === 'ready' && (picked || []).length > 0 && subject.trim() && text.trim();

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="modal notify-modal" role="dialog" aria-label="Notify client">
        <div className="drawer-head">
          <div>
            <h2>Notify client</h2>
            <div className="sub">
              Sends from <strong>your Gmail</strong> — replies come back to you.
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {status === 'sent' ? (
            <div className="notify-sent">
              ✅ Sent to <strong>{(result?.sent_to || []).length}</strong>{' '}
              {(result?.sent_to || []).length === 1 ? 'person' : 'people'}:{' '}
              {(result?.sent_to || []).join(', ')}.
              <div style={{ marginTop: 8 }}>
                Each got their own link. It’s all in your Gmail Sent folder, and replies come
                straight to you.
              </div>
              {/* A partial failure is surfaced, not swallowed — "sent to 2 of 3" is actionable. */}
              {result?.failed?.length > 0 && (
                <div className="notify-err" style={{ marginTop: 10 }}>
                  Could not send to {result.failed.map((f) => f.email).join(', ')}.
                </div>
              )}
            </div>
          ) : (
            <>
              {draft?.recipients?.length > 0 && (
                <div className="notify-to">
                  <div className="notify-to-head">
                    Goes to {draft.recipients.length}{' '}
                    {draft.recipients.length === 1 ? 'person' : 'people'} on{' '}
                    <strong>{draft.client_name}</strong>’s team — each gets their own link.
                  </div>
                  {draft.recipients.map((r) => (
                    <label key={r.id} className="notify-recip">
                      <input
                        type="checkbox"
                        checked={(picked || []).includes(r.id)}
                        onChange={(e) => setPicked((prev) => (
                          e.target.checked
                            ? [...(prev || []), r.id]
                            : (prev || []).filter((x) => x !== r.id)
                        ))}
                      />
                      <span>
                        <strong>{r.name || r.email}</strong>
                        {r.role && <span className="notify-recip-role"> · {r.role}</span>}
                        {r.name && <span className="notify-recip-email"> &lt;{r.email}&gt;</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="field">
                <label>Anything to add? (optional)</label>
                <input
                  type="text"
                  value={note}
                  placeholder="e.g. We heard back from the town — survey is Tuesday."
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => { setEdited(false); load(note); }}
                />
                <div className="placeholder-note" style={{ padding: '4px 0 0' }}>
                  This is the most useful line in the email — it’s why a person sends it, not a robot.
                </div>
              </div>

              <div className="field">
                <label>Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => { setEdited(true); setSubject(e.target.value); }}
                />
              </div>

              <div className="field">
                <label>
                  Message — this is what they’ll receive
                  {draft?.recipients?.length > 1 && (
                    <span className="notify-hint"> (each greeted by their own name)</span>
                  )}
                </label>
                <textarea
                  className="notify-body"
                  rows={14}
                  value={text}
                  onChange={(e) => { setEdited(true); setText(e.target.value); }}
                />
              </div>

              {error && <div className="notify-err">{error}</div>}
            </>
          )}
        </div>

        <div className="drawer-foot">
          {status === 'sent'
            ? <button className="btn btn-primary" onClick={onClose}>Done</button>
            : (
              <>
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={send} disabled={!canSend || status === 'sending'}>
                  {status === 'sending'
                    ? 'Sending…'
                    : `Send to ${(picked || []).length} ${(picked || []).length === 1 ? 'person' : 'people'}`}
                </button>
              </>
            )}
        </div>
      </div>
    </>
  );
}
