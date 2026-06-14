// RM117 app shell — sidebar, dashboard (calendar + inbox + job stats), BMS at /bms.
// Layout inspired by Steward (steward.cc) — layout only.
// Calendar/inbox widgets are placeholders until Phase 0 creds exist
// (COMPANY_CALENDAR_ID, Clerk Google OAuth). Job stats are live via /api/jobs.
import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import BmsDashboard from './rm117-dashboard-v1.jsx';
import { money, PIPELINE_PHASES } from './lib/format.js';

const NAV = [
  { to: '/', icon: '⌂', label: 'Dashboard', end: true },
  { to: '/bms', icon: '▤', label: 'BMS' },
  { to: '/forefront', icon: '◈', label: 'Forefront', soon: 'Phase 6' },
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
              <Route path="/forefront" element={<ComingSoon title="Forefront Commissions" phase="Phase 6" detail="Per-job commission tracking, payment logging, and an outstanding-commissions summary. Data lands in Phase 2's import — no new data entry." />} />
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
        <div className="card">
          <div className="card-head"><h3>Calendar</h3></div>
          <div className="card-body placeholder-note">
            Front and center once connected: your Google Calendar plus the shared company
            calendar (<code>COMPANY_CALENDAR_ID</code>). Requires Phase 0 — Clerk Google OAuth
            (<code>calendar.readonly</code>) and the company calendar ID in <code>.env</code>.
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Priority Inbox</h3></div>
          <div className="card-body placeholder-note">
            Your own Gmail priority inbox (per-user OAuth via Clerk, <code>gmail.readonly</code>).
            Separate from BMS job correspondence (<code>projects@rm117.com</code>) — the two are
            never conflated. Requires Phase 0 Clerk setup.
          </div>
        </div>
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
