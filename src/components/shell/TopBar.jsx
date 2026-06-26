// Top header bar (desktop): search, a data-driven "Supabase live" status chip,
// and the primary "New job" action.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';

export default function TopBar() {
  const navigate = useNavigate();
  const [source, setSource] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/jobs')
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
