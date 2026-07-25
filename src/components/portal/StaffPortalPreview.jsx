// Staff-side preview: pick a client and see the portal exactly as they would.
// Reuses the ClientPortal component in `preview` mode; staff token authorizes
// the /api/portal/preview + /files endpoints (staff may view any job).
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';
import { searchPortalClients } from '../../lib/search.js';

// Shares the lazy ClientPortal chunk with the auth gate's client path.
const ClientPortal = lazy(() => import('../../rm117-portal-v1.jsx'));

export default function StaffPortalPreview() {
  const { getToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  // Jobs are loaded purely so the picker can be searched by JOB ID — staff think in
  // Job IDs at least as often as in client names, and the portal is the one screen
  // that's keyed by client instead.
  const [jobs, setJobs] = useState([]);
  // Arriving from the top-bar global search (`/portal?client=<id>`) preselects them.
  const [sel, setSel] = useState(searchParams.get('client') || '');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    apiFetch('/api/clients')
      .then((r) => r.json())
      .then((d) => setClients((d.clients || []).filter((c) => c && c.name)))
      .catch(() => {});
    // Best-effort: without it the picker still works, just not by Job ID.
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
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

  const selectedName = clients.find((c) => c.id === sel)?.name || '';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Client Portal</div>
          <h1 className="greeting">Portal preview</h1>
        </div>
      </div>
      <div className="cp-preview-banner">
        <strong>This is a preview — nothing here is sent.</strong> The portal <em>is</em> live: a client
        gets in through the magic link in a “✉ Notify client” email, sent from the job’s Progress tab.
        Pick a client below to see exactly what they see.
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <ClientPicker
          clients={clients}
          jobs={jobs}
          value={sel}
          valueName={selectedName}
          onChange={setSel}
        />
      </div>

      {status === 'loading' && <div className="card placeholder-note" style={{ padding: 20 }}>Loading the client’s portal…</div>}
      {status === 'error' && <div className="card placeholder-note" style={{ padding: 20 }}>Couldn’t load that client’s portal.</div>}
      {status === 'ready' && data?.client && (
        data.jobs?.length
          ? (
            <Suspense fallback={<div className="card placeholder-note" style={{ padding: 20 }}>Loading the client’s portal…</div>}>
              <ClientPortal client={data.client} jobs={data.jobs} preview />
            </Suspense>
          )
          : <div className="card placeholder-note" style={{ padding: 20 }}>{data.client.name} has no jobs linked yet — nothing to show in the portal.</div>
      )}
    </div>
  );
}

// Type-to-search client picker. Replaces a native <select> that had grown to 97
// options — a list you scroll is fine at 10 and useless at 100.
//
// Searches client names AND Job IDs (see searchPortalClients): the portal is the one
// screen keyed by client, while every other screen — and every conversation in the
// office — is keyed by Job ID. Typing `26_027` should get you there.
//
// Keyboard: ↑/↓ move, Enter picks, Esc closes. Mirrors the Drawing QA JobPicker so
// the two type-to-search boxes in the app behave identically.
function ClientPicker({ clients, jobs, value, valueName, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  // When a client is picked, the input shows their name. Focusing to search again
  // shouldn't have to be preceded by manually clearing it, so a query equal to the
  // current selection is treated as "browse everything".
  const effectiveQuery = query === valueName ? '' : query;
  const matches = useMemo(
    () => searchPortalClients(effectiveQuery, jobs, clients),
    [effectiveQuery, jobs, clients],
  );

  useEffect(() => { setHighlight(0); }, [effectiveQuery]);

  // Keep the box in step when the selection changes from outside (e.g. the top-bar
  // global search deep-links in with ?client=).
  useEffect(() => { setQuery(valueName || ''); }, [valueName]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (m) => {
    if (m.unlinked) return; // nothing to preview — the row is informational
    onChange(m.clientId);
    setQuery(m.title);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[highlight]) { e.preventDefault(); pick(matches[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="cp-pick-row cp-combo" ref={boxRef}>
      <label htmlFor="cp-pick">See the portal as a client:</label>
      <div className="cp-combo-box">
        <input
          id="cp-pick"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="cp-pick-list"
          autoComplete="off"
          className="cp-combo-input"
          placeholder="Search a client name or Job ID…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="cp-combo-clear"
            aria-label="Clear the selected client"
            onClick={() => { onChange(''); setQuery(''); setOpen(false); }}
          >
            ×
          </button>
        )}
        {open && (
          <ul className="cp-combo-list" id="cp-pick-list" role="listbox">
            {matches.length === 0 && <li className="cp-combo-empty">No client or Job ID matches that.</li>}
            {matches.map((m, i) => (
              <li
                key={m.clientId || m.meta}
                role="option"
                aria-selected={i === highlight}
                aria-disabled={m.unlinked || undefined}
                className={`cp-combo-opt${i === highlight ? ' is-active' : ''}${m.unlinked ? ' is-unlinked' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              >
                <span className="cp-combo-name">{m.title}</span>
                {m.meta && <span className="cp-combo-meta">{m.meta}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
