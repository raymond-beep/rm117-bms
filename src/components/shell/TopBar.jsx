// Top header bar (desktop): global search across every job and client.
//
// This is the app's only search that ignores where you are. The board's own
// search box (rm117-dashboard-v1) filters the jobs in the ACTIVE TAB, so a lead
// is invisible from the Pipeline tab; this one searches the whole book and takes
// you to the record. Job → the board with its editor open. Client → the portal
// preview loaded as them.
//
// Jobs + clients are fetched ONCE (the bar mounts with the shell and outlives
// navigation) and filtered in memory — the whole book is ~230 rows, so a server
// search endpoint would be slower than this and add a round-trip per keystroke.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { searchRecords } from '../../lib/search.js';

export default function TopBar() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => { if (alive) setJobs(d.jobs || []); })
      .catch(() => {});
    apiFetch('/api/clients')
      .then((r) => r.json())
      .then((d) => { if (alive) setClients(d.clients || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ⌘K / Ctrl-K from anywhere focuses search.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes the results.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const results = useMemo(() => searchRecords(q, jobs, clients), [q, jobs, clients]);
  useEffect(() => { setCursor(0); }, [q]);

  function go(hit) {
    if (!hit) return;
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    if (hit.kind === 'job') navigate(`/bms?job=${encodeURIComponent(hit.id)}`);
    else navigate(`/portal?client=${encodeURIComponent(hit.id)}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[cursor]);
    }
  }

  const showResults = open && q.trim().length > 0;

  return (
    <header className="topbar">
      <div className="topbar-search" ref={boxRef}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          placeholder="Search every job and client…"
          aria-label="Search jobs and clients"
          role="combobox"
          aria-expanded={showResults}
          aria-controls="topbar-results"
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd className="topbar-kbd">⌘K</kbd>

        {showResults && (
          <div className="topbar-results" id="topbar-results" role="listbox">
            {results.length === 0 && (
              <div className="tr-empty">No job or client matches “{q.trim()}”.</div>
            )}
            {results.map((hit, i) => (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`tr-hit${i === cursor ? ' active' : ''}`}
                onPointerEnter={() => setCursor(i)}
                onClick={() => go(hit)}
              >
                <span className={`tr-kind ${hit.kind}`}>{hit.kind === 'job' ? 'JOB' : 'CLIENT'}</span>
                <span className="tr-main">{hit.title}</span>
                {hit.meta && <span className="tr-meta">{hit.meta}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="topbar-spacer" />
    </header>
  );
}
