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
        body: JSON.stringify({ job_id: job.job_id, note, subject, text }),
      });
      const d = await r.json();
      if (!r.ok) { const e = new Error(d.error || 'Send failed'); e.code = d.code; throw e; }
      setStatus('sent');
      onSent?.(d);
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  const canSend = status === 'ready' && draft?.to && subject.trim() && text.trim();

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
              ✅ Sent to <strong>{draft?.to}</strong>. It’s in your Gmail Sent folder, and their
              reply will come straight to you.
            </div>
          ) : (
            <>
              {draft?.to && (
                <div className="notify-to">
                  To <strong>{draft.client_name}</strong> &lt;{draft.to}&gt;
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
                <label>Message — this is exactly what they’ll receive</label>
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
                  {status === 'sending' ? 'Sending…' : 'Send email'}
                </button>
              </>
            )}
        </div>
      </div>
    </>
  );
}
