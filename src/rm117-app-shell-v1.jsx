// RM117 app shell — sidebar, mobile chrome, routing, and the auth/role gate.
// The dashboard home, calendar/inbox widgets, settings, portal preview, and the
// mobile field-note sheet live in ./components/ — this file owns the layout.
import React, { Suspense, lazy, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { ErrorBoundary, RoleGate } from './components/shell/auth-gate.jsx';
import { usePortalSession, PortalSplash, PortalLinkExpired, PortalClient } from './components/shell/portal-gate.jsx';
import PortalLogin, { shouldShowClientLogin, readStaffOverride } from './components/shell/portal-login.jsx';
import UserChip from './components/shell/UserChip.jsx';
import TopBar from './components/shell/TopBar.jsx';

// Route pages + on-demand sheets are lazy so each is its own chunk: staff pages
// load on navigation (and never load at all for a portal client, who is routed
// to ClientPortal by RoleGate before these mount); the field-note / appearance
// sheets load only when opened.
const BmsDashboard = lazy(() => import('./rm117-dashboard-v1.jsx'));
const ForefrountView = lazy(() => import('./rm117-forefront-v1.jsx'));
const Home = lazy(() => import('./components/dashboard/Home.jsx'));
const StaffPortalPreview = lazy(() => import('./components/portal/StaffPortalPreview.jsx'));
const Financial = lazy(() => import('./components/financial/Financial.jsx'));
const Settings = lazy(() => import('./components/settings/Settings.jsx'));
const MobileThemeSheet = lazy(() => import('./components/settings/MobileThemeSheet.jsx'));
const FieldNoteSheet = lazy(() => import('./components/field-note-sheet/FieldNoteSheet.jsx'));
const SiteReport = lazy(() => import('./components/site-report/SiteReport.jsx'));
const TemplatesHome = lazy(() => import('./components/templates/TemplatesHome.jsx'));
const LetterGenerator = lazy(() => import('./components/templates/LetterGenerator.jsx'));
const ProposalGenerator = lazy(() => import('./components/templates/ProposalGenerator.jsx'));
const DrawingQA = lazy(() => import('./components/drawing-qa/DrawingQA.jsx'));
const Delegation = lazy(() => import('./components/delegation/Delegation.jsx'));
const Mail = lazy(() => import('./components/mail/Mail.jsx'));
const Clients = lazy(() => import('./components/clients/Clients.jsx'));

const RouteFallback = () => <div className="page"><div className="card"><div className="empty">Loading…</div></div></div>;

// Bottom tab bar (mobile) — the live workspace surfaces. Forefront lives in the
// desktop sidebar only; the mobile bar surfaces Financial in its slot instead.
const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/bms', label: 'Jobs', icon: '▤' },
  { to: '/financial', label: 'Financial', icon: '$' },
  { to: '/portal', label: 'Portal', icon: '◱' },
];

// Sidebar order = how much the thing is actually used, busiest at the top.
// Re-ordered 2026-08-05 against measured 30-day write activity, not intuition. Settings is
// pinned to the bottom separately.
//
// ⚠️ **Writes undercount read-heavy tabs.** Dashboard, Mail, Financial and Clients are mostly
// LOOKED AT, and reading leaves no row behind — so their measured numbers are floors, not
// estimates. Don't re-sort this list on row counts alone next time; weigh what people open.
// (Financial's payment rows are especially misleading: the Zapier/QBO cron writes them, not a
// person visiting the tab.)
//
// What the data actually said, 30d / 7d:
//   Weekly Planner 105/37 (used daily — it had been SEVENTH) · Project Management 15/4 ·
//   Checksets 3/0 · Templates 3/1 · Mail 2/2 (shipped 2026-07-31; filing ≠ reading) ·
//   Forefront 0/0 (last commission 2026-06-13) · Client Portal **0, never used by anyone**.
//
// The portal is deliberately near the bottom despite being fully built (three login doors,
// Pay Now, the site button): not one magic link has ever been minted. Ray's call 2026-08-05 —
// the sidebar should report reality, and portal adoption gets solved as its own problem
// rather than by hopeful placement. Move it back up if that ever changes.
const NAV_GROUPS = [
  {
    caption: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/mail', label: 'Mail' },
      // Label only — the route stays /bms so existing links and bookmarks keep working.
      { to: '/bms', label: 'Project Management' },
      { to: '/delegation', label: 'Weekly Planner' },
      { to: '/financial', label: 'Financial' },
      { to: '/clients', label: 'Clients' },
      { to: '/drawing-qa', label: 'Checksets' },
      { to: '/portal', label: 'Client Portal' },
      { to: '/forefront', label: 'Forefront' },
    ],
  },
  // The two document generators, lifted out of the Templates hub (Ray, 2026-08-05: they are
  // the most useful things in the app and were two clicks away). They get their own group
  // rather than a slot in Workspace because that list is ordered by DAILY frequency and these
  // are episodic — one per new lead, one per permit review. A caption gives them one-click
  // access without claiming they're daily tools.
  //
  // ⚠️ **`/templates` is still a live route, just not a nav item** — same pattern as `/bms`
  // keeping its route after the label change. The generators' "← Templates" back-link and any
  // existing bookmark still work. It stopped earning a sidebar slot because it was a hub of
  // two real cards plus two greyed-out "Soon" ones (Invoice, Email) that were never built —
  // a click that mostly advertised things that don't exist. When Invoice or Email do get
  // built, add them to THIS group.
  //
  // Why this looked low-use and isn't: the `proposals` table had 1 row, but Save is optional
  // in both generators — you can build, download, and send to Drive without ever saving. The
  // real volume is 16 jobs sitting in "Proposal Sent" right now. Don't judge these two by
  // their table counts.
  {
    caption: 'Documents',
    items: [
      { to: '/templates/proposal', label: 'Proposal' },
      { to: '/templates/letter', label: 'Building-Dept Letter' },
    ],
  },
];

export default function AppShell() {
  const [themeSheet, setThemeSheet] = useState(false);
  const [noteSheet, setNoteSheet] = useState(false);
  const location = useLocation();
  // The site report is a standalone, print-friendly page (opened in its own tab):
  // render it full-bleed without the sidebar/topbar/tabbar chrome. Still staff-only
  // (inside SignedIn + RoleGate; the API is staff-gated too).
  const isReport = location.pathname.startsWith('/report/');

  // Magic-link clients resolve BEFORE Clerk: they have no Clerk account, so without
  // this they'd hit the staff Google sign-in screen. Staff have no portal cookie, so
  // this costs them nothing (no probe, no delay) and falls straight through.
  const portal = usePortalSession();
  const linkExpired = new URLSearchParams(location.search).get('portal_error');
  if (portal.status === 'loading') return <PortalSplash />;
  if (portal.status === 'client') return <PortalClient client={portal.client} jobs={portal.jobs} promptPassword={portal.promptPassword} />;

  // No session. WHICH sign-in belongs here depends on who's knocking: the staff app and the
  // client portal are one Vercel deployment, so a client arriving at portal.rm117.com used to
  // land on the staff Google screen with no way forward. Hostname decides (see
  // shouldShowClientLogin); staff on the Vercel URL are unaffected.
  const clientDoor = shouldShowClientLogin({
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
    pathname: location.pathname,
    search: location.search,
    staffOverride: readStaffOverride(location.search),
  });

  // An expired link used to be a dead end ("reply to your last email and we'll send a fresh
  // one"). Now it has a self-serve way out, so hand it straight to the login with an
  // explanation. Off the client door there's nothing to offer, so the old copy still stands.
  if (linkExpired) {
    return clientDoor
      ? <PortalLogin notice="That link has expired. Sign in with your email instead — it only takes a moment." />
      : <PortalLinkExpired />;
  }
  if (clientDoor) return <PortalLogin />;

  return (
    <>
      <SignedOut>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0f0f0f' }}>
          <SignIn />
        </div>
      </SignedOut>
      <SignedIn>
        <RoleGate>
        {isReport ? (
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/report/:jobId" element={<SiteReport />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        ) : (
        <div className="shell">
          <aside className="sidebar">
            <div className="sidebar-logo">
              <div className="logo-badge">R</div>
              <div className="logo-text">
                <div className="logo-mark">RM117</div>
                <small>Architecture &amp; Design</small>
              </div>
            </div>
            <nav>
              {NAV_GROUPS.map((group) => (
                <React.Fragment key={group.caption}>
                  <div className="nav-cap">{group.caption}</div>
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                      {item.label}
                    </NavLink>
                  ))}
                </React.Fragment>
              ))}
              <div className="nav-spacer" />
              <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Settings</NavLink>
            </nav>
            <div className="sidebar-footer">
              <div className="cl-userbutton"><UserButton /></div>
              <UserChip />
            </div>
          </aside>
          <header className="mobile-topbar">
            <div className="brand">RM117<small>Architecture &amp; Design</small></div>
            <div className="mobile-topbar-actions">
              <button className="mobile-appearance" onClick={() => setThemeSheet(true)} aria-label="Appearance">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <UserButton />
            </div>
          </header>
          <div className="content">
            <TopBar />
            <main className="main">
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/bms" element={<BmsDashboard />} />
                    <Route path="/forefront" element={<ForefrountView />} />
                    <Route path="/financial" element={<Financial />} />
                    <Route path="/templates" element={<TemplatesHome />} />
                    <Route path="/templates/letter" element={<LetterGenerator />} />
                    <Route path="/templates/proposal" element={<ProposalGenerator />} />
                    <Route path="/drawing-qa" element={<DrawingQA />} />
                    <Route path="/delegation" element={<Delegation />} />
                    <Route path="/mail" element={<Mail />} />
                    <Route path="/clients" element={<Clients />} />
                    <Route path="/portal" element={<StaffPortalPreview />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<div className="page"><div className="page-head"><div><div className="eyebrow">404</div><h1 className="greeting">Not found</h1></div></div></div>} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          <button className="note-fab" onClick={() => setNoteSheet(true)} aria-label="New field note">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <nav className="mobile-tabbar">
            {MOBILE_TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </NavLink>
            ))}
          </nav>
          <Suspense fallback={null}>
            {themeSheet && <MobileThemeSheet onClose={() => setThemeSheet(false)} />}
            {noteSheet && <FieldNoteSheet onClose={() => setNoteSheet(false)} />}
          </Suspense>
        </div>
        )}
        </RoleGate>
      </SignedIn>
    </>
  );
}
