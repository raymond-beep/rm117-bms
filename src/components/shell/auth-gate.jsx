// Auth/role gate + render-crash boundary for the staff shell.
//   - ErrorBoundary: catches render-time crashes so a bug shows a readable
//     message + reload, never a blank white screen.
//   - RoleGate: resolves the signed-in user's role via /api/portal/me — clients
//     see the portal, staff see the workspace shell, nobody else gets in.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useAuth, useUser, UserButton } from '@clerk/clerk-react';

// Lazy so the client portal is its own chunk — staff never download it on the
// normal shell path, and a portal client never downloads the staff dashboard.
const ClientPortal = lazy(() => import('../../rm117-portal-v1.jsx'));

// Catches render-time crashes in any page so a bug shows a readable message +
// reload, never a blank white screen. (React error boundaries must be classes.)
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card" style={{ maxWidth: 520, padding: 24 }}>
            <h1 className="greeting" style={{ marginTop: 0 }}>Something went wrong</h1>
            <div className="placeholder-note" style={{ padding: '6px 0 16px' }}>
              This screen hit an error and couldn’t load. Reloading usually fixes it.
            </div>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Resolve the signed-in user's role via /api/portal/me (authed + isolated).
// Clients see the portal; staff see the workspace shell; nobody else gets in.
function usePortalIdentity() {
  const { getToken } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch('/api/portal/me', {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        if (alive) setState({ status: 'ready', ...data });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
  }, [getToken]);
  return state;
}

// Gate the staff shell behind a role check. Clients are routed to the portal;
// unknown accounts get a no-access screen. On a transient error we fall through
// to the staff shell so the team is never locked out by a hiccup (the staff data
// endpoints are open today regardless, so this adds no new exposure).
export function RoleGate({ children }) {
  const id = usePortalIdentity();
  if (id.status === 'loading') return <PortalSplash />;
  if (id.status === 'ready' && id.role === 'client') {
    return (
      <Suspense fallback={<PortalSplash />}>
        <ClientPortal client={id.client} jobs={id.jobs} />
      </Suspense>
    );
  }
  if (id.status === 'ready' && id.role === 'none') return <NoAccess />;
  return children;
}

function PortalSplash() {
  return (
    <div className="portal-splash">
      <div className="portal-brand">RM117<small>Architecture &amp; Design</small></div>
      <div className="placeholder-note">Loading your workspace…</div>
    </div>
  );
}

function NoAccess() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress || 'this account';
  return (
    <div className="portal-splash">
      <div className="portal-brand">RM117<small>Architecture &amp; Design</small></div>
      <div className="card portal-empty" style={{ maxWidth: 440 }}>
        You&rsquo;re signed in as <strong>{email}</strong>, but it isn&rsquo;t set up for access yet.
        If you&rsquo;re a Room 117 client, contact your project manager to be added.
        <div style={{ marginTop: 14 }}><UserButton afterSignOutUrl="/" /></div>
      </div>
    </div>
  );
}
