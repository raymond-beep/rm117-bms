// Messages tab (client thread) — staff side of the per-job client thread.
// Reads/posts via the portal endpoints (same store the client sees); staff
// replies post as 'staff' (render as RM117).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

export default function MessagesTab({ job }) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch(`/api/portal/messages?job_id=${encodeURIComponent(job.job_id)}`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      setMessages(d.messages || []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [job.job_id, getToken]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const token = await getToken();
      const r = await fetch('/api/portal/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ job_id: job.job_id, body: text }),
      });
      if (!r.ok) throw new Error('send failed');
      const { message } = await r.json();
      setMessages((m) => [...m, message]);
      setDraft('');
    } catch {
      alert('Message could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="drawer-body">
      <p className="hint" style={{ marginTop: 0 }}>
        One thread with the client for this job. Your replies post as <strong>RM117</strong>. Email notifications come later.
      </p>
      <div className="staff-thread" ref={bodyRef}>
        {status === 'loading' && <div className="placeholder-note">Loading messages…</div>}
        {status === 'error' && <div className="placeholder-note">Couldn’t load messages.</div>}
        {status === 'ready' && messages.length === 0 && <div className="placeholder-note">No messages yet.</div>}
        {status === 'ready' && messages.map((m) => (
          <div key={m.id} className={`cp-msg ${m.sender_type === 'staff' ? 'mine' : 'them'}`}>
            <div className="cp-msg-meta">
              {m.sender_type === 'staff' ? 'RM117' : 'Client'} · {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div className="cp-msg-bubble">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="cp-composer staff-composer">
        <input
          className="cp-composer-input"
          placeholder="Reply to the client…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="cp-composer-send" onClick={send} disabled={sending || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}
