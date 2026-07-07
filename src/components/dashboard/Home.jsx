// Dashboard home — greeting + the live job-stat strip (active pipeline,
// outstanding, ready-to-bill, Forefront) and the calendar + inbox widgets.
import React, { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { money, PIPELINE_PHASES } from '../../lib/format.js';
import { apiFetch } from '../../lib/api.js';
import CalendarWidget from './CalendarWidget.jsx';
import InboxWidget from './InboxWidget.jsx';
import MyWeekWidget from './MyWeekWidget.jsx';

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

export default function Home() {
  const [stats, setStats] = useState(null);
  const [source, setSource] = useState(null);

  useEffect(() => {
    apiFetch('/api/jobs')
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

      <MyWeekWidget />

      <div className="grid-2">
        <CalendarWidget />
        <InboxWidget />
      </div>
    </div>
  );
}
