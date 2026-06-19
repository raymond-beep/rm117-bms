// RM117 app shell — sidebar, dashboard (calendar + inbox + job stats), BMS at /bms.
// Layout inspired by Steward (steward.cc) — layout only.
// Calendar/inbox widgets are placeholders until Phase 0 creds exist
// (COMPANY_CALENDAR_ID, Clerk Google OAuth). Job stats are live via /api/jobs.
import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn, UserButton, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import BmsDashboard from './rm117-dashboard-v1.jsx';
import ForefrountView from './rm117-forefront-v1.jsx';
import ClientPortal from './rm117-portal-v1.jsx';
import { money, PIPELINE_PHASES } from './lib/format.js';
import { useTheme, THEMES } from './lib/theme.jsx';

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
function RoleGate({ children }) {
  const id = usePortalIdentity();
  if (id.status === 'loading') return <PortalSplash />;
  if (id.status === 'ready' && id.role === 'client') return <ClientPortal client={id.client} jobs={id.jobs} />;
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

// Bottom tab bar (mobile) — the live workspace surfaces only.
const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/bms', label: 'Jobs', icon: '▤' },
  { to: '/forefront', label: 'Forefront', icon: '◈' },
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
      { to: '/templates', label: 'Templates' },
      { to: '/portal', label: 'Client Portal' },
    ],
  },
];

export default function AppShell() {
  return (
    <>
      <SignedOut>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0f0f0f' }}>
          <SignIn />
        </div>
      </SignedOut>
      <SignedIn>
        <RoleGate>
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
            <UserButton />
          </header>
          <div className="content">
            <TopBar />
            <main className="main">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/bms" element={<BmsDashboard />} />
                <Route path="/forefront" element={<ForefrountView />} />
                <Route path="/templates" element={<ComingSoon title="Templates" phase="Document library" detail="Proposal, agreement, CD-set, and client-letter templates — grouped by category. Coming in the redesign build." />} />
                <Route path="/portal" element={<StaffPortalPreview />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<div className="page"><div className="page-head"><div><div className="eyebrow">404</div><h1 className="greeting">Not found</h1></div></div></div>} />
              </Routes>
            </main>
          </div>
          <nav className="mobile-tabbar">
            {MOBILE_TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        </RoleGate>
      </SignedIn>
    </>
  );
}

// Initials for an avatar (up to 2 letters from a sender/display name).
function initials(name) {
  const parts = String(name || '').replace(/<.*>/, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Pipeline shape: job counts per phase, ordered earliest → latest stage
// (Potential → Outgoing). A real current snapshot — unlike created_at, which only
// records the Sheet→Supabase import date and so can't drive a meaningful trend.
const PIPELINE_SHAPE = ['potential', 'survey_zoning', 'design_phase', 'cd_phase', 'active'];
const PIPELINE_SHAPE_LABELS = {
  potential: 'Proposal Sent', survey_zoning: 'Survey/Zoning', design_phase: 'Design',
  cd_phase: 'CD', active: 'Outgoing',
};
function pipelineShape(jobs) {
  return PIPELINE_SHAPE.map((phase) => ({
    phase,
    count: jobs.filter((j) => j.phase === phase).length,
  }));
}

// Mini bar chart; bars sized by count, the latest two stages solid-accent.
function Sparkline({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="spark">
      {data.map((d, i) => (
        <div
          key={d.phase}
          className={`spark-bar${i >= data.length - 2 ? ' full' : ''}`}
          style={{ height: `${Math.max(12, (d.count / max) * 100)}%` }}
          title={`${PIPELINE_SHAPE_LABELS[d.phase]}: ${d.count}`}
        />
      ))}
    </div>
  );
}

// Pip bars for a small count (e.g. ready-to-bill). Always shows at least 3 slots.
function Pips({ count }) {
  const slots = Math.max(3, count);
  return (
    <div className="pips">
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} className={`pip${i < count ? ' on' : ''}`} />
      ))}
    </div>
  );
}

function Home() {
  const [stats, setStats] = useState(null);
  const [source, setSource] = useState(null);

  useEffect(() => {
    fetch('/api/jobs')
      .then((r) => r.json())
      .then(({ source, jobs }) => {
        const pipeline = jobs.filter((j) => PIPELINE_PHASES.includes(j.phase));
        const outstandingOf = (rows) => rows.reduce((s, j) => s + Math.max(0, Number(j.outstanding || 0)), 0);
        const ffActiveJobs = jobs.filter((j) => j.is_forefront && j.phase !== 'completed');
        const pipelineValue = pipeline.reduce((s, j) => s + Number(j.job_total || 0), 0);
        const outstanding = outstandingOf(pipeline);
        const ffBooked = ffActiveJobs.reduce((s, j) => s + Number(j.ff_commission || 0), 0);
        const ffOwed = jobs
          .filter((j) => j.is_forefront && !j.ff_commission_paid)
          .reduce((s, j) => s + Number(j.ff_commission || 0), 0);
        setSource(source);
        setStats({
          pipelineCount: pipeline.length,
          pipelineValue,
          spark: pipelineShape(jobs),
          // Outstanding = collectible balance on ACTIVE work only. Completed/on-hold
          // balances are legacy QBO noise (disorganized) — surfaced separately, not
          // mixed into the headline. (Underlying records untouched; reconcile w/ Ang later.)
          outstanding,
          outstandingPct: pipelineValue > 0 ? Math.round((outstanding / pipelineValue) * 100) : 0,
          legacyOutstanding: outstandingOf(jobs.filter((j) => !PIPELINE_PHASES.includes(j.phase))),
          billFlags: jobs.filter((j) => j.bill_flag).length,
          ffActive: ffActiveJobs.length,
          ffOwed,
          ffPaidPct: ffBooked > 0 ? Math.round(((ffBooked - ffOwed) / ffBooked) * 100) : 0,
        });
      })
      .catch(() => setStats(null));
  }, []);

  const { user } = useUser();
  const firstName = user?.firstName || 'there';
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const now = new Date();
  const dateLabel = now
    .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase()
    .replace(',', '');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Home base</div>
          <h1 className="greeting">Good {partOfDay}, {firstName}.</h1>
        </div>
        <div className="page-meta">
          {dateLabel}<br />
          {source === 'mock'
            ? <span className="mock">● Sample data</span>
            : <span className="live">● Supabase live</span>}
        </div>
      </div>

      {stats && (
        <div className="stat-strip">
          {/* Active pipeline — count + pipeline-shape distribution by phase */}
          <div className="stat-cell">
            <div className="stat-top">
              <div className="label">Active<br />pipeline</div>
            </div>
            <div className="value">{stats.pipelineCount}<span className="unit">jobs</span></div>
            <div className="stat-visual"><Sparkline data={stats.spark} /></div>
            <div className="hint">{money(stats.pipelineValue)} contracted</div>
          </div>

          {/* Outstanding — pct delta + progress bar */}
          <div className="stat-cell">
            <div className="stat-top">
              <div className="label">Outstanding</div>
              <span className="stat-delta warn">{stats.outstandingPct}%</span>
            </div>
            <div className="value">{money(stats.outstanding)}</div>
            <div className="stat-visual">
              <div className="progbar"><div className="progbar-fill" style={{ width: `${Math.min(100, stats.outstandingPct)}%` }} /></div>
            </div>
            <div className="hint">
              of {money(stats.pipelineValue)} contracted
              <small>{money(stats.legacyOutstanding)} on completed / on-hold</small>
            </div>
          </div>

          {/* Ready to bill — pip bars */}
          <div className="stat-cell">
            <div className="stat-top">
              <div className="label">Ready to<br />bill</div>
            </div>
            <div className="value">{stats.billFlags}<span className="unit">flagged</span></div>
            <div className="stat-visual"><Pips count={stats.billFlags} /></div>
            <div className="hint">bill flags set</div>
          </div>

          {/* Forefront — completion ring (commission paid / booked) */}
          <div className="stat-cell">
            <div className="stat-top">
              <div className="label">Forefront</div>
              <span className="stat-delta up">ACTIVE</span>
            </div>
            <div className="ring-wrap">
              <div>
                <div className="value">{stats.ffActive}<span className="unit">active</span></div>
                <div className="hint">{money(stats.ffOwed)} commission unpaid</div>
              </div>
              <div className="ring" style={{ '--pct': stats.ffPaidPct }}>
                <span className="ring-val">{stats.ffPaidPct}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid-2">
        <CalendarWidget />
        <InboxWidget />
      </div>
    </div>
  );
}

function UserChip() {
  const { user } = useUser();
  const name = user?.fullName || user?.firstName || 'Signed in';
  return (
    <div className="who">{name}<br />Room 117</div>
  );
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// 6-week (42-cell) matrix for `viewMonth`, starting on the Sunday on/before the 1st.
function monthMatrix(viewMonth) {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// Calendar widget — a real month grid (today highlighted, event days dotted) plus
// an agenda of upcoming events. Reads the user's Google Calendar + the shared
// company calendar (COMPANY_CALENDAR_ID) via /api/calendar. Needs calendar.readonly.
function CalendarWidget() {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const [state, setState] = useState({ status: 'loading', events: [] });
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch('/api/calendar?days=45', {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        if (!alive) return;
        if (!data.connected) setState({ status: 'disconnected', reason: data.reason, events: [] });
        else setState({ status: 'ready', events: data.events || [] });
      } catch {
        if (alive) setState({ status: 'error', events: [] });
      }
    })();
    return () => { alive = false; };
  }, [getToken]);

  const today = new Date();
  const todayKey = dayKey(today);
  const eventDays = new Set(state.events.map((e) => dayKey(new Date(e.start))));
  const cells = monthMatrix(viewMonth);
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shiftMonth = (n) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  const fmtChip = (iso) => {
    const d = new Date(iso);
    return { mon: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), day: d.getDate(), key: dayKey(d) };
  };
  const fmtTime = (ev) =>
    ev.allDay ? 'All day'
      : new Date(ev.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="card">
      <div className="card-head">
        <h3>Calendar</h3>
        <span className="head-meta">{state.status === 'ready' ? `${state.events.length} UPCOMING` : 'NEXT 45 DAYS'}</span>
      </div>
      <div className="cal2">
        <div className="cal-month">
          <div className="cal-month-head">
            <span className="cal-month-title">{monthLabel}</span>
            <button className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <button className="cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
            <button className="cal-today-btn" onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          </div>
          <div className="cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-days">
            {cells.map((d, i) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const cls = ['cal-day'];
              if (!inMonth) cls.push('other');
              if (k === todayKey) cls.push('today');
              if (eventDays.has(k)) cls.push('has-event');
              return <div key={i} className={cls.join(' ')}>{d.getDate()}</div>;
            })}
          </div>
        </div>

        <div className="cal-agenda">
          {state.status === 'loading' && <div className="placeholder-note">Loading your calendar…</div>}
          {state.status === 'error' && <div className="placeholder-note">Couldn’t load the calendar right now.</div>}
          {state.status === 'disconnected' && (
            <div className="placeholder-note">
              {state.reason === 'clerk_not_configured'
                ? 'Google isn’t configured yet.'
                : state.reason === 'google_reauth_needed'
                  ? 'Reconnect Google and grant calendar access to see your events here.'
                  : 'Connect your Google account (read-only) to see your calendar here.'}
              {state.reason !== 'clerk_not_configured' && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => clerk.openUserProfile()}>Connect Google</button>
                </div>
              )}
            </div>
          )}
          {state.status === 'ready' && state.events.length === 0 && (
            <div className="placeholder-note">Nothing scheduled in the next 45 days.</div>
          )}
          {state.status === 'ready' && state.events.length > 0 && (
            <ul className="cal-agenda-list">
              {state.events.slice(0, 8).map((ev) => {
                const chip = fmtChip(ev.start);
                return (
                  <li key={`${ev.calendar}-${ev.id}`} className="agenda-item">
                    <div className={`agenda-chip${chip.key === todayKey ? ' today' : ''}`}>
                      {chip.mon}<span className="d">{chip.day}</span>
                    </div>
                    <div className="agenda-main">
                      <span className="agenda-title">{ev.title}</span>
                      <span className="agenda-time">
                        {fmtTime(ev)}{ev.calendar === 'company' && <span className="agenda-tag"> · RM117</span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Per-user Gmail Priority Inbox, filtered to client senders (Phase 0).
// Reads the signed-in user's own Gmail (read-only) via /api/inbox. Client mail
// is surfaced first and tagged; everything else is dimmed. No shared mailbox.
function InboxWidget() {
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
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => clerk.openUserProfile()}>Connect Google</button>
              </div>
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

// Staff-side preview: pick a client and see the portal exactly as they would.
// Reuses the ClientPortal component in `preview` mode; staff token authorizes
// the /api/portal/preview + /files endpoints (staff may view any job).
function StaffPortalPreview() {
  const { getToken } = useAuth();
  const [clients, setClients] = useState([]);
  const [sel, setSel] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => setClients((d.clients || []).filter((c) => c && c.name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sel) { setData(null); setStatus('idle'); return; }
    let alive = true;
    setStatus('loading');
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/portal/preview?client_id=${encodeURIComponent(sel)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (alive) { setData(d); setStatus('ready'); }
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [sel, getToken]);

  const sorted = [...clients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Client Portal</div>
          <h1 className="greeting">Portal preview</h1>
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <div className="cp-pick-row">
          <label htmlFor="cp-pick">See the portal as a client:</label>
          <select id="cp-pick" className="cp-pick" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Select a client…</option>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {status === 'loading' && <div className="card placeholder-note" style={{ padding: 20 }}>Loading the client’s portal…</div>}
      {status === 'error' && <div className="card placeholder-note" style={{ padding: 20 }}>Couldn’t load that client’s portal.</div>}
      {status === 'ready' && data?.client && (
        data.jobs?.length
          ? <ClientPortal client={data.client} jobs={data.jobs} preview />
          : <div className="card placeholder-note" style={{ padding: 20 }}>{data.client.name} has no jobs linked yet — nothing to show in the portal.</div>
      )}
    </div>
  );
}

// Top header bar (desktop): search, a data-driven "Supabase live" status chip,
// and the primary "New job" action. The Mobile preview button arrives with the
// mobile build; theme switching lives in Settings (and, later, the mobile sheet).
function TopBar() {
  const navigate = useNavigate();
  const [source, setSource] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => { if (alive) setSource(d.source); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const live = source && source !== 'mock';
  return (
    <header className="topbar">
      <div className="topbar-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input type="search" placeholder="Search jobs, clients, invoices…" aria-label="Search" />
      </div>
      <div className="topbar-spacer" />
      <span className={`status-chip${live ? '' : ' mock'}`}>
        <span className="dot" />
        {source == null ? 'Connecting…' : live ? 'Supabase live' : 'Sample data'}
      </span>
      <button className="topbar-btn primary" onClick={() => navigate('/bms')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New job
      </button>
    </header>
  );
}

// Settings: the 5-theme picker (live, persisted) + shared defaults. Type stays
// IBM Plex across every theme — only colour changes.
function Settings() {
  const { theme, setTheme, clientsOnly, setClientsOnly, reducedMotion, setReducedMotion } = useTheme();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="greeting">Settings</h1>
        </div>
      </div>

      <div className="set-block">
        <div className="set-section-cap">Theme</div>
        <div className="set-theme-grid">
          {THEMES.map((t) => {
            const active = t.key === theme;
            return (
              <button
                key={t.key}
                className={`set-theme-card${active ? ' active' : ''}`}
                onClick={() => setTheme(t.key)}
                aria-pressed={active}
              >
                <div className="set-theme-preview" style={{ background: t.bg }}>
                  <div className="pv-bar" style={{ background: t.swatch, width: '42%' }} />
                  <div className="pv-row">
                    <div className="pv-dot" style={{ background: t.swatch }} />
                    <div className="pv-line" style={{ background: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
                  </div>
                  <div className="pv-row">
                    <div className="pv-line" style={{ background: t.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)' }} />
                  </div>
                </div>
                <div className="set-theme-foot">
                  <span className="set-theme-name">{t.label}</span>
                  {active
                    ? <span className="check">✓</span>
                    : <span className="set-theme-mode">{t.mode}</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="set-note">Sets colour across every screen — type stays IBM Plex throughout.</div>
      </div>

      <div className="set-block">
        <div className="set-section-cap">Defaults</div>
        <div className="set-card">
          <div className="set-toggle-row">
            <div>
              <div className="set-toggle-label">Priority Inbox — clients only</div>
              <div className="set-toggle-desc">Dim non-client mail by default on the dashboard. Synced with the toggle on the inbox card.</div>
            </div>
            <Toggle checked={clientsOnly} onChange={setClientsOnly} label="Clients only" />
          </div>
          <div className="set-toggle-row">
            <div>
              <div className="set-toggle-label">Reduced motion</div>
              <div className="set-toggle-desc">Minimise transitions on toggles, drawers, and sheets.</div>
            </div>
            <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Reduced motion" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="knob" />
    </label>
  );
}

function ComingSoon({ title, phase, detail }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{phase}</div>
          <h1 className="greeting">{title}</h1>
        </div>
      </div>
      <div className="card"><div className="card-body placeholder-note">{detail}</div></div>
    </div>
  );
}
