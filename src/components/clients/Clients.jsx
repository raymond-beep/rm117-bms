// Clients directory (/clients). One screen showing every client the firm has, their contact
// details, their jobs and their portal contacts — and, deliberately, the holes.
//
// Tom and Angelena asked for "a tab that reflects what's in the database". The honest version
// of that is not a pretty table: measured on the live data, 44 of 97 clients have an email,
// 12 have a phone, none has a company, and 40 of 166 jobs are attached to no client at all.
// Those gaps were previously invisible — client details are only editable one-job-at-a-time
// inside a job's Details tab, so nothing ever showed you the shape of the whole set. Hence the
// gap flags and the unlinked-jobs panel: this screen is where the data gets fixed, not just
// admired.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { filterClientDirectory } from '../../lib/search.js';
import { phaseLabel, addressLine, money } from '../../lib/format.js';

const TYPES = ['homeowner', 'investor', 'contractor', 'other'];

// Phases that mean "no longer live". A client whose jobs are all finished is not missing a
// phone number in any urgent sense, so they are not flagged for it.
const COLD = new Set(['completed', 'canceled', 'job_dropped']);

function isLive(client) {
  return (client.jobs || []).some((j) => !COLD.has(j.phase_override || j.phase));
}

// What's missing that someone could actually act on. Only raised for clients with live work —
// flagging a 2023 client for a missing phone number is noise that trains people to ignore
// the flags entirely.
function gapsFor(client) {
  if (!isLive(client)) return [];
  const gaps = [];
  if (!client.email) gaps.push('no email');
  if (!client.phone) gaps.push('no phone');
  return gaps;
}

// ── one editable client row ────────────────────────────────────────────────
function ClientRow({ client, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(client);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // The row is remounted with fresh data after a save; keep the draft in step if the
  // parent's copy changes underneath (e.g. another save on the same list).
  useEffect(() => { setForm(client); }, [client]);

  const gaps = gapsFor(client);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: client.id,
          name: form.name,
          type: form.type,
          email: form.email,
          phone: form.phone,
          company: form.company,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setEditing(false);
      onSaved(d.client || { ...client, ...form });
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const cancel = () => { setForm(client); setEditing(false); setErr(null); };

  return (
    <div className={`cl-row${open ? ' is-open' : ''}`}>
      <button type="button" className="cl-row-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="cl-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="cl-name">
          {client.name}
          {client.company && <span className="cl-company"> · {client.company}</span>}
        </span>
        <span className="cl-meta">
          {client.jobs.length} job{client.jobs.length === 1 ? '' : 's'}
        </span>
        <span className="cl-contactbits">
          {client.email ? <span className="cl-has" title={client.email}>✉</span> : null}
          {client.phone ? <span className="cl-has" title={client.phone}>☎</span> : null}
          {gaps.map((g) => <span key={g} className="cl-gap">{g}</span>)}
        </span>
      </button>

      {open && (
        <div className="cl-body">
          <div className="cl-detail">
            {!editing ? (
              <>
                <dl className="cl-dl">
                  <div><dt>Type</dt><dd>{client.type || '—'}</dd></div>
                  <div><dt>Email</dt><dd>{client.email || <span className="cl-empty">not on file</span>}</dd></div>
                  <div><dt>Phone</dt><dd>{client.phone || <span className="cl-empty">not on file</span>}</dd></div>
                  <div><dt>Company</dt><dd>{client.company || <span className="cl-empty">not on file</span>}</dd></div>
                </dl>
                <button type="button" className="cl-btn" onClick={() => setEditing(true)}>Edit details</button>
              </>
            ) : (
              <div className="cl-form">
                <label className="cl-field"><span>Name</span><input value={form.name || ''} onChange={set('name')} /></label>
                <label className="cl-field"><span>Type</span>
                  <select value={form.type || 'homeowner'} onChange={set('type')}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="cl-field"><span>Email</span><input value={form.email || ''} onChange={set('email')} placeholder="name@example.com" /></label>
                <label className="cl-field"><span>Phone</span><input value={form.phone || ''} onChange={set('phone')} placeholder="(908) 555-0100" /></label>
                <label className="cl-field"><span>Company</span><input value={form.company || ''} onChange={set('company')} placeholder="Optional" /></label>
                <div className="cl-form-actions">
                  <button type="button" className="cl-btn primary" onClick={save} disabled={saving || !String(form.name || '').trim()}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="cl-btn" onClick={cancel} disabled={saving}>Cancel</button>
                </div>
                {err && <div className="cl-err">{err}</div>}
              </div>
            )}
          </div>

          <div className="cl-cols">
            <div>
              <div className="cl-subhead">Jobs</div>
              {client.jobs.length === 0 ? (
                <div className="cl-empty">No jobs linked to this client.</div>
              ) : (
                <ul className="cl-joblist">
                  {client.jobs.map((j) => (
                    <li key={j.job_id}>
                      <Link to={`/bms?job=${encodeURIComponent(j.job_id)}`} className="cl-joblink">{j.job_id}</Link>
                      <span className="cl-jobphase">{phaseLabel(j)}</span>
                      {j.is_forefront && <span className="cl-tag ff">FF</span>}
                      {j.is_fire_escape && <span className="cl-tag fe">FE</span>}
                      {j.address && <div className="cl-jobaddr">{addressLine(j.address)}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="cl-subhead">Portal contacts</div>
              {client.contacts.length === 0 ? (
                <div className="cl-empty">
                  No contacts yet — they’re added per job, on the Correspondence tab.
                </div>
              ) : (
                <ul className="cl-contactlist">
                  {client.contacts.map((ct) => (
                    <li key={ct.id}>
                      <span className="cl-ct-name">{ct.name || ct.email}</span>
                      {ct.is_primary && <span className="cl-tag">primary</span>}
                      {ct.role && <span className="cl-ct-role">{ct.role}</span>}
                      <div className="cl-ct-email">{ct.email}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── the page ───────────────────────────────────────────────────────────────
export default function Clients() {
  const [data, setData] = useState({ status: 'loading' });
  const [q, setQ] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [showUnlinked, setShowUnlinked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch('/api/clients/directory', { cache: 'no-store' });
        const d = await r.json();
        if (!alive) return;
        if (!r.ok) setData({ status: 'error', error: d.error });
        else setData({ status: 'ready', clients: d.clients || [], unlinkedJobs: d.unlinkedJobs || [] });
      } catch {
        if (alive) setData({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, []);

  // Patch the saved client in place rather than refetching — a refetch would collapse the
  // row the person is working in and lose their place in a 97-row list.
  const onSaved = (updated) => setData((d) => (d.status === 'ready' ? {
    ...d,
    clients: d.clients.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
  } : d));

  const clients = data.clients || [];
  const shown = useMemo(() => {
    const matched = filterClientDirectory(q, clients);
    return onlyGaps ? matched.filter((c) => gapsFor(c).length > 0) : matched;
  }, [q, clients, onlyGaps]);

  const gapCount = useMemo(() => clients.filter((c) => gapsFor(c).length > 0).length, [clients]);
  const unlinked = data.unlinkedJobs || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Clients</h2>
          <div className="page-sub">
            {data.status === 'ready'
              ? `${clients.length} clients · ${shown.length === clients.length ? 'all shown' : `${shown.length} shown`}`
              : 'Loading…'}
          </div>
        </div>
        <div className="cl-tools">
          <input
            className="cl-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, company, email, Job ID, address…"
            aria-label="Search clients"
          />
        </div>
      </div>

      {data.status === 'loading' && <div className="placeholder-note">Loading clients…</div>}
      {data.status === 'error' && (
        <div className="placeholder-note">Couldn’t load the client list{data.error ? ` — ${data.error}` : ''}.</div>
      )}

      {data.status === 'ready' && (
        <>
          {/* The two things worth acting on, stated up front rather than buried in the list. */}
          <div className="cl-flags">
            {gapCount > 0 && (
              <button
                type="button"
                className={`cl-flag${onlyGaps ? ' is-on' : ''}`}
                onClick={() => setOnlyGaps((v) => !v)}
              >
                {gapCount} active client{gapCount === 1 ? '' : 's'} missing an email or phone
                <span className="cl-flag-act">{onlyGaps ? 'show all' : 'show these'}</span>
              </button>
            )}
            {unlinked.length > 0 && (
              <button
                type="button"
                className={`cl-flag${showUnlinked ? ' is-on' : ''}`}
                onClick={() => setShowUnlinked((v) => !v)}
              >
                {unlinked.length} job{unlinked.length === 1 ? '' : 's'} not linked to any client
                <span className="cl-flag-act">{showUnlinked ? 'hide' : 'show these'}</span>
              </button>
            )}
          </div>

          {showUnlinked && (
            <div className="card cl-unlinked">
              <div className="cl-subhead">Jobs with no client</div>
              <p className="cl-note">
                Mostly Drive imports — the sync deliberately leaves the client blank rather than
                guess, because a wrong link is worse than none. Link one from its job page.
              </p>
              <ul className="cl-joblist cl-joblist-wide">
                {unlinked.map((j) => (
                  <li key={j.job_id}>
                    <Link to={`/bms?job=${encodeURIComponent(j.job_id)}`} className="cl-joblink">{j.job_id}</Link>
                    {j.client_name && <span className="cl-ct-role">{j.client_name}</span>}
                    <span className="cl-jobphase">{phaseLabel(j)}</span>
                    {j.job_total ? <span className="cl-jobtotal">{money(j.job_total)}</span> : null}
                    {j.address && <div className="cl-jobaddr">{addressLine(j.address)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card cl-list">
            {shown.length === 0 ? (
              <div className="placeholder-note">
                {onlyGaps ? 'No active clients are missing contact details.' : `Nothing matched “${q}”.`}
              </div>
            ) : (
              shown.map((c) => <ClientRow key={c.id} client={c} onSaved={onSaved} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
