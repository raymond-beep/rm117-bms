// RM117 app shell — sidebar, mobile chrome, routing, and the auth/role gate.
// The dashboard home, calendar/inbox widgets, settings, portal preview, and the
// mobile field-note sheet live in ./components/ — this file owns the layout.
import React, { Suspense, lazy, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { ErrorBoundary, RoleGate } from './components/shell/auth-gate.jsx';
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

const RouteFallback = () => <div className="page"><div className="card"><div className="empty">Loading…</div></div></div>;

// Bottom tab bar (mobile) — the live workspace surfaces. Forefront lives in the
// desktop sidebar only; the mobile bar surfaces Financial in its slot instead.
const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/bms', label: 'Jobs', icon: '▤' },
  { to: '/financial', label: 'Financial', icon: '$' },
  { to: '/portal', label: 'Portal', icon: '◱' },
];

// "Drafting + data" nav: Templates and Client Portal are first-class items
// alongside Dashboard / BMS / Forefront. Settings is pinned to the bottom.
const NAV_GROUPS = [
  {
    caption: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/bms', label: 'BMS' },
      { to: '/forefront', label: 'Forefront' },
      { to: '/financial', label: 'Financial' },
      { to: '/templates', label: 'Templates' },
      { to: '/drawing-qa', label: 'Drawing QA' },
      { to: '/portal', label: 'Client Portal' },
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
