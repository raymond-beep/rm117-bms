// Magic-link portal gate — sits ABOVE the Clerk gates in the shell.
//
// A client who arrives from an email link has NO Clerk session (Clerk is staff-only
// Google sign-in). Without this, they'd land on the staff sign-in screen and be stuck.
// So before Clerk gets a say: if a portal session cookie is present, resolve it and
// render the client portal instead.
//
// The signed credential is HttpOnly and unreadable from JS. A second, non-sensitive
// "hint" cookie tells us a session MAY exist — so staff (who never have it) skip the
// probe entirely and pay nothing for this path.
import React, { Suspense, lazy, useEffect, useState } from 'react';

const ClientPortal = lazy(() => import('../../rm117-portal-v1.jsx'));

const HINT_COOKIE = 'rm117_portal';

export const hasPortalHint = () =>
  typeof document !== 'undefined' && new RegExp(`(?:^|;\\s*)${HINT_COOKIE}=1(?:;|$)`).test(document.cookie);

// Resolve the cookie session. Returns { status: 'loading' | 'client' | 'none' }.
// Anything unexpected resolves to 'none' so the normal staff flow still renders —
// a hiccup here must never lock the team out.
export function usePortalSession() {
  const [state, setState] = useState(() => (hasPortalHint() ? { status: 'loading' } : { status: 'none' }));

  useEffect(() => {
    if (state.status !== 'loading') return undefined;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/portal/me', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        if (!alive) return;
        setState(d?.role === 'client' ? { status: 'client', client: d.client, jobs: d.jobs } : { status: 'none' });
      } catch {
        if (alive) setState({ status: 'none' });
      }
    })();
    return () => { alive = false; };
  }, [state.status]);

  return state;
}

export function PortalSplash() {
  return (
    <div className="portal-splash">
      <div className="portal-brand">RM117<small>Architecture &amp; Design</small></div>
      <div className="placeholder-note">Loading your project…</div>
    </div>
  );
}

// Shown when /api/portal/enter rejected the token (expired, revoked, or bogus). A
// client should never see a JSON error or a staff sign-in box — just a plain next step.
export function PortalLinkExpired() {
  return (
    <div className="portal-splash">
      <div className="portal-brand">RM117<small>Architecture &amp; Design</small></div>
      <div className="card portal-empty" style={{ maxWidth: 460 }}>
        <strong>This link has expired.</strong>
        <div style={{ marginTop: 8 }}>
          Project links stop working after a while for security. Reply to your last email from us
          and we’ll send you a fresh one.
        </div>
      </div>
    </div>
  );
}

export function PortalClient({ client, jobs }) {
  return (
    <Suspense fallback={<PortalSplash />}>
      <ClientPortal client={client} jobs={jobs} />
    </Suspense>
  );
}
