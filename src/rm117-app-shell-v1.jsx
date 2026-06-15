// RM117 app shell — sidebar, dashboard (calendar + inbox + job stats), BMS at /bms.
// Layout inspired by Steward (steward.cc) — layout only.
// Calendar/inbox widgets are placeholders until Phase 0 creds exist
// (COMPANY_CALENDAR_ID, Clerk Google OAuth). Job stats are live via /api/jobs.
import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn, UserButton, useAuth, useClerk } from '@clerk/clerk-react';
import BmsDashboard from './rm117-dashboard-v1.jsx';
import ForefrountView from './rm117-forefront-v1.jsx';
import { money, PIPELINE_PHASES } from './lib/format.js';

const NAV = [
  { to: '/', icon: '⌂', label: 'Dashboard', end: true },
  { to: '/bms', icon: '▤', label: 'BMS' },
  { to: '/forefront', icon: '◈', label: 'Forefront' },
  { to: '/templates', icon: '✉', label: 'Templates', soon: 'Phase 5' },
  { to: '/portal', icon: '⚿', label: 'Client Portal', soon: 'Phase 7' },
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
        <div className="shell">
          <aside className="sidebar">
            <div className="sidebar-logo">
              RM117
              <small>Room 117 Architecture &amp; Design</small>
            </div>
            <nav>
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  <span className="icon">{item.icon}</span>
                  {item.label}
                  {item.soon && <span className="soon">{item.soon}</span>}
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-footer" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserButton />
              <span>Second generation · Supabase-backed</span>
            </div>
          </aside>
          <main className="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/bms" element={<BmsDashboard />} />
              <Route path="/forefront" element={<ForefrountView />} />
              <Route path="/templates" element={<ComingSoon title="Templates" phase="Phase 5" detail="Proposal, invoice, and email templates — stored in the database and iterated without code changes. Proposals send via DocuSign; invoices create in QuickBooks via the QBO API." />} />
              <Route path="/portal" element={<ComingSoon title="Client Portal" phase="Phase 7" detail="Clients log in with the email on file, see only their own jobs, download documents from the vault, and message the firm — one thread per job, bridged to email." />} />
              <Route path="*" element={<div className="page"><h1 className="page-title">Not found</h1></div>} />
            </Routes>
          </main>
        </div>
      </SignedIn>
    </>
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
        setSource(source);
        setStats({
          pipelineCount: pipeline.length,
          pipelineValue: pipeline.reduce((s, j) => s + Number(j.job_total || 0), 0),
          outstanding: jobs.reduce((s, j) => s + Math.max(0, Number(j.outstanding || 0)), 0),
          billFlags: jobs.filter((j) => j.bill_flag).length,
        });
      })
      .catch(() => setStats(null));
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        Room 117 Architecture &amp; Design — home base.
        {source === 'mock' && ' Showing sample data until Supabase is connected (Phase 0–1).'}
      </p>

      {stats && (
        <div className="stat-row">
          <div className="stat-tile">
            <div className="label">Active pipeline</div>
            <div className="value">{stats.pipelineCount} jobs</div>
            <div className="hint">{money(stats.pipelineValue)} contracted</div>
          </div>
          <div className="stat-tile">
            <div className="label">Outstanding</div>
            <div className="value">{money(stats.outstanding)}</div>
            <div className="hint">across all jobs</div>
          </div>
          <div className="stat-tile">
            <div className="label">Ready to bill</div>
            <div className="value">{stats.billFlags}</div>
            <div className="hint">bill flags set</div>
          </div>
          <div className="stat-tile">
            <div className="label">Data source</div>
            <div className="value" style={{ fontSize: 16, paddingTop: 6 }}>
              <span className={`source-pill source-${source}`}>{source === 'supabase' ? 'Supabase (live)' : 'Mock data'}</span>
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

// Upcoming events from the signed-in user's Google Calendar (read-only) via
// /api/calendar — their primary calendar plus the shared company calendar
// (COMPANY_CALENDAR_ID). Same Google OAuth as the inbox; needs calendar.readonly.
function CalendarWidget() {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch('/api/calendar?days=14', {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        if (!alive) return;
        if (!data.connected) setState({ status: 'disconnected', reason: data.reason });
        else setState({ status: 'ready', events: data.events || [] });
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [getToken]);

  const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (ev) =>
    ev.allDay ? 'All day'
      : new Date(ev.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="card">
      <div className="card-head"><h3>Calendar</h3></div>
      <div className="card-body">
        {state.status === 'loading' && <div className="placeholder-note">Loading your calendar…</div>}

        {state.status === 'error' && (
          <div className="placeholder-note">Couldn’t load the calendar right now. Try refreshing.</div>
        )}

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
          <div className="placeholder-note">Nothing scheduled in the next 14 days.</div>
        )}

        {state.status === 'ready' && state.events.length > 0 && (
          <ul className="cal-list">
            {state.events.map((ev) => (
              <li key={`${ev.calendar}-${ev.id}`} className={`cal-item cal-${ev.calendar}`}>
                <div className="cal-when">
                  <span className="cal-day">{fmtDay(ev.start)}</span>
                  <span className="cal-time">{fmtTime(ev)}</span>
                </div>
                <div className="cal-main">
                  <span className="cal-title">{ev.title}</span>
                  {ev.location && <span className="cal-loc">{ev.location}</span>}
                </div>
                {ev.calendar === 'company' && <span className="cal-tag">RM117</span>}
              </li>
            ))}
          </ul>
        )}
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
  const [state, setState] = useState({ status: 'loading' });
  const [clientsOnly, setClientsOnly] = useState(true);

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
      <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Priority Inbox</h3>
        {state.status === 'ready' && (
          <label style={{ fontSize: 12, fontWeight: 400, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={clientsOnly} onChange={(e) => setClientsOnly(e.target.checked)} />
            Clients only
          </label>
        )}
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
              <li key={m.id} className={`inbox-item${m.isClient ? ' is-client' : ''}`}>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ComingSoon({ title, phase, detail }) {
  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">{phase}</p>
      <div className="card"><div className="card-body placeholder-note">{detail}</div></div>
    </div>
  );
}
