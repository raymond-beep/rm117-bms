// Calendar widget — a real month grid (today highlighted, event days dotted) plus
// an agenda of upcoming events. Reads the user's Google Calendar + the shared
// company calendar (COMPANY_CALENDAR_ID) via /api/calendar. Needs calendar.readonly.
import React, { useEffect, useState } from 'react';
import { useAuth, useClerk } from '@clerk/clerk-react';

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

export default function CalendarWidget() {
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
