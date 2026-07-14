// Staff-side preview: pick a client and see the portal exactly as they would.
// Reuses the ClientPortal component in `preview` mode; staff token authorizes
// the /api/portal/preview + /files endpoints (staff may view any job).
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';

// Shares the lazy ClientPortal chunk with the auth gate's client path.
const ClientPortal = lazy(() => import('../../rm117-portal-v1.jsx'));

export default function StaffPortalPreview() {
  const { getToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  // Arriving from the top-bar global search (`/portal?client=<id>`) preselects them.
  const [sel, setSel] = useState(searchParams.get('client') || '');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    apiFetch('/api/clients')
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
      <div className="cp-preview-banner">
        <strong>This is a preview — nothing here is sent.</strong> The portal <em>is</em> live: a client
        gets in through the magic link in a “✉ Notify client” email, sent from the job’s Progress tab.
        Pick a client below to see exactly what they see.
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
