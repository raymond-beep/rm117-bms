// Per-user Gmail Priority Inbox, filtered to client senders (Phase 0).
// Reads the signed-in user's own Gmail (read-only) via /api/inbox. Client mail
// is surfaced first and tagged; everything else is dimmed. No shared mailbox.
import React, { useEffect, useState } from 'react';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { useTheme } from '../../lib/theme.jsx';
import Toggle from '../ui/Toggle.jsx';

// Initials for an avatar (up to 2 letters from a sender/display name).
function initials(name) {
  const parts = String(name || '').replace(/<.*>/, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function InboxWidget() {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const { clientsOnly, setClientsOnly } = useTheme();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/inbox?clientsOnly=${clientsOnly ? 1 : 0}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        if (!alive) return;
        if (!data.connected) setState({ status: 'disconnected', reason: data.reason });
        else setState({ status: 'ready', messages: data.messages || [] });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [getToken, clientsOnly]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Priority Inbox</h3>
        <label className="inbox-toggle">
          Clients only
          <Toggle checked={clientsOnly} onChange={setClientsOnly} label="Clients only" />
        </label>
      </div>
      <div className="card-body">
        {state.status === 'loading' && <div className="placeholder-note">Loading your inbox…</div>}

        {state.status === 'error' && (
          <div className="placeholder-note">Couldn’t load the inbox right now. Try refreshing.</div>
        )}

        {state.status === 'disconnected' && (
          <div className="placeholder-note">
            {state.reason === 'clerk_not_configured'
              ? 'Gmail isn’t configured yet (Phase 0 Clerk setup pending).'
              : 'Connect your Google account (read-only Gmail) to see client emails here.'}
            {state.reason !== 'clerk_not_configured' && (
              <>
                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => clerk.openUserProfile()}>Connect Google</button>
                </div>
                <div className="inbox-connect-hint">
                  Make sure to grant Gmail &amp; Calendar access. If you skipped it when you signed
                  in, sign out and back in and select those features.
                </div>
              </>
            )}
          </div>
        )}

        {state.status === 'ready' && state.messages.length === 0 && (
          <div className="placeholder-note">
            No {clientsOnly ? 'client ' : ''}emails in the last 14 days.
          </div>
        )}

        {state.status === 'ready' && state.messages.length > 0 && (
          <ul className="inbox-list">
            {state.messages.map((m) => (
              <li key={m.id} className={`inbox-item${m.isClient ? ' is-client' : ' dim'}`}>
                <div className="inbox-ava">{initials(m.from)}</div>
                <div className="inbox-main">
                  <div className="inbox-row">
                    <span className="inbox-from">{m.from}</span>
                    {m.isClient && (
                      <span className="inbox-tag" title={m.jobs.join(', ')}>
                        {m.jobs.length === 1 ? m.jobs[0] : (m.clientLabel || 'Client')}
                      </span>
                    )}
                  </div>
                  <div className="inbox-subj">{m.subject}</div>
                  <div className="inbox-snip">{m.snippet}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
