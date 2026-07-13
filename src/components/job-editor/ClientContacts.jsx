// Everyone attached to a client — the people who get project updates and portal access.
//
// The firm's biggest clients are DEVELOPERS with teams (Tyler Deuel, 5 jobs; Gabe DaSilva,
// already cramming a shared team inbox into the single email field). One address per client
// never matched how they actually work.
//
// Contacts belong to the CLIENT, so adding a developer's project manager once puts them on
// all of that client's projects. Each person gets their OWN magic link when an update goes
// out — so removing someone revokes only their access, not the whole team's.
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function ClientContacts({ clientId }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: '' });

  const load = useCallback(async () => {
    if (!clientId) { setContacts([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await apiFetch(`/api/client-contacts?client_id=${encodeURIComponent(clientId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load contacts');
      setContacts((d.contacts || []).filter((c) => c.is_active));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.email.trim()) return;
    setError(null);
    try {
      const r = await apiFetch('/api/client-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ...form }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not add that person');
      setForm({ name: '', email: '', role: '' });
      setAdding(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(c) {
    setError(null);
    try {
      const r = await apiFetch(`/api/client-contacts?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not remove that person');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!clientId) return null;

  return (
    <div className="contacts">
      <div className="pay-form-title" style={{ marginTop: 0 }}>
        Who gets project updates
      </div>
      <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
        Everyone here receives the update email and can open the portal — each with their own
        link. Good for developers whose team helps run the project.
      </div>

      {loading ? (
        <div className="placeholder-note">Loading…</div>
      ) : (
        <>
          {contacts.length === 0 && (
            <div className="contacts-empty">
              Nobody on file — this client can’t be notified until you add someone.
            </div>
          )}

          <ul className="contact-list">
            {contacts.map((c) => (
              <li key={c.id} className="contact-row">
                <div className="contact-who">
                  <div className="contact-name">
                    {c.name || c.email}
                    {c.is_primary && <span className="badge badge-pill contact-primary">PRIMARY</span>}
                    {c.role && <span className="contact-role">{c.role}</span>}
                  </div>
                  {c.name && <div className="contact-email">{c.email}</div>}
                </div>
                {/* The primary is the client themselves — removing them would leave nobody. */}
                {!c.is_primary && (
                  <button
                    className="btn-link-tiny"
                    onClick={() => remove(c)}
                    title="Remove from the project — this also revokes their portal link"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {adding ? (
            <div className="contact-add">
              <div className="field-row">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Name</label>
                  <input
                    type="text" value={form.name} placeholder="Sarah Chen"
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Role (optional)</label>
                  <input
                    type="text" value={form.role} placeholder="Project manager"
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Email</label>
                <input
                  type="email" value={form.email} placeholder="sarah@breatheeasyremodeling.com"
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                />
              </div>
              <div className="contact-add-actions">
                <button className="btn" onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={add} disabled={!form.email.trim()}>Add</button>
              </div>
            </div>
          ) : (
            <button className="btn-link-tiny" onClick={() => setAdding(true)}>+ Add someone</button>
          )}

          {error && <div className="contacts-err">{error}</div>}
        </>
      )}
    </div>
  );
}
