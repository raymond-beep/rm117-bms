// JobEditor drawer — Details / Progress / Payments / Messages tabs for one job.
// Details edits save optimistically through the parent's onSave (rollback there).
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { isPlaceholderJobId } from '../../lib/job-id.js';
import {
  money, shortDate, addressLine, PHASE_ORDER, PHASE_LABELS,
  SUB_PHASES, SUB_PHASE_LABELS, subPhasesFor,
} from '../../lib/format.js';
import ProgressTab from './ProgressTab.jsx';
import PaymentsTab from './PaymentsTab.jsx';
import MessagesTab from './MessagesTab.jsx';
import CorrectJobIdModal from './CorrectJobIdModal.jsx';
import ClientContacts from './ClientContacts.jsx';

// Field tags: which fields the client sees in the portal vs internal-only.
const PortalTag = () => <span className="tag-portal" title="Visible to the client in the portal">👁 client</span>;
const InternalTag = () => <span className="tag-internal" title="Internal only — never shown to clients">🔒 internal</span>;

export default function JobEditor({ job, onClose, onSave, onPaymentLogged, onRenamed }) {
  const [tab, setTab] = useState('details');
  const [renaming, setRenaming] = useState(false);
  const [form, setForm] = useState(() => ({
    client_id: job.client_id || '',
    client_name: job.client_name || '',
    address: addressLine(job.address),
    phase: job.phase,
    sub_phase: job.sub_phase || '',
    design_phase_count: job.design_phase_count || '',
    phase_override: job.phase_override || '',
    job_total: job.job_total ?? 0,
    bill_flag: Boolean(job.bill_flag),
    is_forefront: Boolean(job.is_forefront),
    ff_commission: job.ff_commission ?? '',
    notes: job.notes || '',
    last_correspondence: job.last_correspondence || '',
  }));
  const [clients, setClients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [cForm, setCForm] = useState({ type: 'homeowner', email: '', phone: '', company: '' });
  const [cSaving, setCSaving] = useState(false);
  const [cMsg, setCMsg] = useState('');

  // Creating a brand-new client from here. The app never had this — every client came from
  // the one-time Sheet migration, so the picker could only choose EXISTING records. A job
  // whose client was never in the app (every lead imported from Drive, and any genuinely new
  // job) had no way to get one. This is that missing path, and it lives in the one place that
  // serves all of them, not just leads.
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', type: 'homeowner', email: '', phone: '', company: '' });
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState(null);

  // Load the client list for the picker — one identity shared with the portal.
  useEffect(() => {
    let live = true;
    apiFetch('/api/clients')
      .then((r) => r.json())
      .then((d) => { if (live) setClients(d.clients || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const linkedClient = clients.find((c) => c.id === form.client_id) || null;

  // Sub-phases available for the phase currently selected in the form. Design is capped
  // by the proposal (design_phase_count), so a 2-phase job offers DPI–DPII only.
  const subOptions = subPhasesFor({ phase: form.phase, design_phase_count: form.design_phase_count });

  // Reading the design-phase count out of the signed proposal. It PRE-FILLS the dropdown —
  // it never saves. Staff eyeball the quoted evidence and hit Save, so a bad read can't slip
  // through silently. (Accurate on 5 of 6 real proposals tested; the 6th couldn't be read.)
  const [dp, setDp] = useState({ loading: false, result: null, error: null });

  // Does this job have a proposal PDF in Drive? The design-phase reader used to be shown
  // only for jobs already IN the design phase — which hid it exactly when it is most useful:
  // a LEAD that has been sent a proposal (17 of the leads imported from Drive have one on
  // file). Show the reader whenever there is something to read.
  const [hasProposal, setHasProposal] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/jobs/proposal-docs?jobId=${encodeURIComponent(job.job_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setHasProposal((d.files || []).length > 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [job.job_id]);

  async function readProposal() {
    setDp({ loading: true, result: null, error: null });
    try {
      const r = await apiFetch(`/api/jobs/design-phases?jobId=${encodeURIComponent(job.job_id)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read the proposal');
      setDp({ loading: false, result: d, error: null });
      // Pre-fill only when there's an actual number; never overwrite with a blank.
      if (d.design_phase_count) {
        setForm((f) => ({ ...f, design_phase_count: String(d.design_phase_count) }));
      }
    } catch (e) {
      setDp({ loading: false, result: null, error: e.message });
    }
  }

  // Changing phase clears any sub-phase from the old one — "Prep" is meaningless in
  // Permitting, and the DB constraint would reject the pair anyway.
  const onPhaseChange = (e) => {
    const phase = e.target.value;
    setForm((f) => ({
      ...f,
      phase,
      sub_phase: (SUB_PHASES[phase] || []).includes(f.sub_phase) ? f.sub_phase : '',
    }));
  };

  // Sync the editable contact fields to whichever client is linked.
  useEffect(() => {
    setCMsg('');
    if (linkedClient) {
      setCForm({
        type: linkedClient.type || 'homeowner',
        email: linkedClient.email || '',
        phone: linkedClient.phone || '',
        company: linkedClient.company || '',
      });
    }
  }, [form.client_id, clients]);

  const cset = (key) => (e) => { setCForm((f) => ({ ...f, [key]: e.target.value })); setCMsg(''); };

  async function saveClient() {
    if (!linkedClient) return;
    setCSaving(true); setError(null); setCMsg('');
    try {
      const r = await apiFetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: linkedClient.id, ...cForm }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save client');
      setClients((list) => list.map((c) => (c.id === d.client.id ? d.client : c)));
      setCMsg('Saved ✓');
    } catch (e) { setError(e.message); } finally { setCSaving(false); }
  }

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const ncset = (key) => (e) => { setNewClient((f) => ({ ...f, [key]: e.target.value })); setNcError(null); };

  // Open the create-client form, seeding the name from the job's display name — a Drive-
  // imported "Corrigan" is then one click from a real, reusable client record.
  function openCreateClient() {
    setNewClient({ name: form.client_name || '', type: 'homeowner', email: '', phone: '', company: '' });
    setNcError(null);
    setCreatingClient(true);
  }

  // Create the client record immediately (it's a real, reusable row the moment it exists),
  // then LINK it to this job by setting client_id — which persists with the normal drawer Save,
  // exactly like every other field here. Also mirror the display name onto the new client so
  // the two don't start out disagreeing.
  async function createClient() {
    const name = newClient.name.trim();
    if (!name) { setNcError('Give the client a name.'); return; }
    setNcSaving(true); setNcError(null);
    try {
      const r = await apiFetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newClient, name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not create the client');
      setClients((list) => [...list, d.client].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setForm((f) => ({ ...f, client_id: d.client.id, client_name: f.client_name || d.client.name }));
      setCreatingClient(false);
    } catch (e) { setNcError(e.message); } finally { setNcSaving(false); }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(job.job_id, {
        ...form,
        client_id: form.client_id || null,
        phase_override: form.phase_override || null,
        sub_phase: form.sub_phase || null,
        design_phase_count: form.design_phase_count === '' ? null : Number(form.design_phase_count),
        job_total: Number(form.job_total) || 0,
        ff_commission: form.ff_commission === '' ? null : Number(form.ff_commission),
        last_correspondence: form.last_correspondence || null,
        notes: form.notes || null,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={`Edit ${job.job_id}`}>
        <div className="drawer-head">
          <div>
            <h2>
              {job.job_id}
              {onRenamed && (
                <button className="btn-link-tiny" onClick={() => setRenaming(true)}
                  title="Rename this Job ID across the app, QuickBooks, and Drive">✎ ID</button>
              )}
            </h2>
            <div className="sub">
              <span className="out">{money(job.outstanding)} outstanding</span> · created {shortDate(job.created_at)}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-tabs">
          <button className={`drawer-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button className={`drawer-tab${tab === 'progress' ? ' active' : ''}`} onClick={() => setTab('progress')}>Progress</button>
          <button className={`drawer-tab${tab === 'payments' ? ' active' : ''}`} onClick={() => setTab('payments')}>Payments</button>
          <button className={`drawer-tab${tab === 'messages' ? ' active' : ''}`} onClick={() => setTab('messages')}>Messages</button>
        </div>

        {tab === 'details' && (
          <>
            <div className="drawer-body">
              <div className="field">
                <label>Linked client <PortalTag /></label>
                <select value={form.client_id} onChange={set('client_id')}>
                  <option value="">— Not linked —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.email ? ` · ${c.email}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {linkedClient ? (
                <div className="client-card">
                  <div className="field-row">
                    <div className="field">
                      <label>Type</label>
                      <select value={cForm.type} onChange={cset('type')}>
                        <option value="homeowner">homeowner</option>
                        <option value="investor">investor</option>
                        <option value="contractor">contractor</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Phone <PortalTag /></label>
                      <input type="tel" value={cForm.phone} onChange={cset('phone')} placeholder="(908) 555-1234" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Email <PortalTag /></label>
                    <input type="email" value={cForm.email} onChange={cset('email')} placeholder="name@example.com" />
                  </div>
                  <div className="field">
                    <label>Company</label>
                    <input type="text" value={cForm.company} onChange={cset('company')} placeholder="optional" />
                  </div>
                  <div className="client-card-actions">
                    <button className="btn" onClick={saveClient} disabled={cSaving}>{cSaving ? 'Saving…' : 'Save contact info'}</button>
                    {cMsg && <span className="client-card-saved">{cMsg}</span>}
                  </div>
                  <div className="client-card-note">Shared with the client portal. Saving updates the client record everywhere it's used.</div>

                  {/* Developers run projects with a team. Everyone here gets the update email
                      and their own portal link — see ClientContacts. */}
                  <ClientContacts clientId={linkedClient.id} />
                </div>
              ) : creatingClient ? (
                <div className="client-card">
                  <div className="client-card-note" style={{ marginTop: 0, marginBottom: 12 }}>
                    New client profile. It becomes a reusable record right away; it links to this job when you Save.
                  </div>
                  <div className="field">
                    <label>Name</label>
                    <input type="text" value={newClient.name} onChange={ncset('name')} placeholder="Client or company name" autoFocus />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Type</label>
                      <select value={newClient.type} onChange={ncset('type')}>
                        <option value="homeowner">homeowner</option>
                        <option value="investor">investor</option>
                        <option value="contractor">contractor</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Phone <PortalTag /></label>
                      <input type="tel" value={newClient.phone} onChange={ncset('phone')} placeholder="(908) 555-1234" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Email <PortalTag /></label>
                    <input type="email" value={newClient.email} onChange={ncset('email')} placeholder="name@example.com" />
                  </div>
                  <div className="field">
                    <label>Company</label>
                    <input type="text" value={newClient.company} onChange={ncset('company')} placeholder="optional" />
                  </div>
                  <div className="client-card-actions">
                    <button className="btn btn-primary" onClick={createClient} disabled={ncSaving || !newClient.name.trim()}>
                      {ncSaving ? 'Creating…' : 'Create + link'}
                    </button>
                    <button className="btn" onClick={() => setCreatingClient(false)} disabled={ncSaving}>Cancel</button>
                    {ncError && <span className="error">{ncError}</span>}
                  </div>
                </div>
              ) : (
                <div className="unlinked-note">
                  <div className="placeholder-note" style={{ padding: 0 }}>
                    Not linked to a client record — this job won’t appear in the client portal.
                    Pick one above, or:
                  </div>
                  <button className="btn" onClick={openCreateClient}>+ Create a client profile</button>
                </div>
              )}
              <div className="field">
                <label>Display name on this job</label>
                <input type="text" value={form.client_name} onChange={set('client_name')} />
              </div>
              <div className="field">
                <label>Address <PortalTag /></label>
                <input type="text" value={form.address} onChange={set('address')} />
              </div>
              {/* A lead runs as 26_xxx_Smith until the proposal is signed — say so, and say
                  what will happen, because a Job ID silently changing itself is alarming. */}
              {isPlaceholderJobId(job.job_id) && (
                <div className="lead-notice">
                  <strong>Lead — no job number yet.</strong> Moving this job past <em>Proposal Sent</em>
                  {' '}assigns the next official Job ID and creates its Drive folder.
                </div>
              )}
              <div className="field-row">
                <div className="field">
                  <label>Phase <PortalTag /></label>
                  <select value={form.phase} onChange={onPhaseChange}>
                    {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                {/* Sub-phase: only Design and CD have one, so the control simply isn't
                    there for the other phases. Internal workload split — never shown to
                    the client (no <PortalTag />). */}
                {subOptions.length > 0 && (
                  <div className="field">
                    <label>Sub-phase</label>
                    <select value={form.sub_phase || ''} onChange={set('sub_phase')}>
                      <option value="">— none —</option>
                      {subOptions.map((s) => (
                        <option key={s} value={s}>{SUB_PHASE_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="field-row">
                {/* How many design phases the signed proposal bought — caps this job's
                    DPI/II/III ladder. The app can read it out of the signed proposal, but it
                    only ever SUGGESTS: staff confirm, because a wrong count silently
                    truncates the client's ladder and nobody would notice.

                    Shown for a job in the design phase, OR for ANY job with a proposal PDF on
                    file. The old design-phase-only gate hid the reader exactly where it earns
                    its keep: a LEAD that has been sent a proposal. You want the count recorded
                    when the proposal lands, not weeks later when the job reaches design. */}
                {(form.phase === 'design_phase' || hasProposal) && (
                  <div className="field">
                    <label>
                      Design phases in the proposal
                      <button
                        type="button"
                        className="btn-link-tiny"
                        onClick={readProposal}
                        disabled={dp.loading}
                        title="Read the signed proposal in Drive and suggest the number"
                      >
                        {dp.loading ? 'Reading…' : '✨ Read proposal'}
                      </button>
                    </label>
                    <select value={form.design_phase_count || ''} onChange={set('design_phase_count')}>
                      <option value="">— not set —</option>
                      <option value="1">1 (DPI)</option>
                      <option value="2">2 (DPI–DPII)</option>
                      <option value="3">3 (DPI–DPIII)</option>
                    </select>
                    {dp.error && <div className="dp-note dp-bad">{dp.error} — set it by hand.</div>}
                    {dp.result && (
                      dp.result.design_phase_count
                        ? (
                          <div className="dp-note">
                            Suggested <strong>{dp.result.design_phase_count}</strong> ({dp.result.confidence} confidence)
                            {' '}from <em>{dp.result.source?.name}</em>. <strong>Check it, then Save.</strong>
                            {dp.result.evidence && <div className="dp-quote">“{dp.result.evidence}”</div>}
                          </div>
                        )
                        : <div className="dp-note dp-bad">The proposal doesn’t say — set it by hand.</div>
                    )}
                  </div>
                )}
                <div className="field">
                  <label>Phase override (wins if set)</label>
                  <input type="text" value={form.phase_override} onChange={set('phase_override')} placeholder="optional label" />
                </div>
              </div>
              <div className="field-row">
                <div className="field mono-field">
                  <label>Job total ($)</label>
                  <input type="number" min="0" step="0.01" value={form.job_total} onChange={set('job_total')} />
                </div>
                <div className="field mono-field">
                  <label>FF commission ($)</label>
                  <input type="number" min="0" step="0.01" value={form.ff_commission} onChange={set('ff_commission')} disabled={!form.is_forefront} />
                </div>
              </div>
              <label className="check-field">
                <input type="checkbox" checked={form.bill_flag} onChange={set('bill_flag')} />
                Ready to bill
              </label>
              <label className="check-field">
                <input type="checkbox" checked={form.is_forefront} onChange={set('is_forefront')} />
                Forefront job (carries a commission)
              </label>
              <div className="field">
                <label>Last correspondence</label>
                <input type="text" value={form.last_correspondence} onChange={set('last_correspondence')} />
              </div>
              <div className="field">
                <label>Notes <InternalTag /></label>
                <textarea value={form.notes} onChange={set('notes')} />
              </div>
              {job.import_needs_review && (
                <div className="field">
                  <label className="review-flag">⚠ Import flagged this row for review</label>
                  <div className="placeholder-note">{job.import_notes || 'No import notes recorded.'}</div>
                </div>
              )}
            </div>
            <div className="drawer-foot">
              {error && <span className="error">{error}</span>}
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}

        {tab === 'progress' && (
          <ProgressTab job={job} onSave={onSave} />
        )}

        {tab === 'payments' && (
          <PaymentsTab job={job} onLogged={onPaymentLogged} />
        )}

        {tab === 'messages' && (
          <MessagesTab job={job} />
        )}
      </div>
      {renaming && (
        <CorrectJobIdModal
          job={job}
          onClose={() => setRenaming(false)}
          onRenamed={() => { setRenaming(false); onRenamed?.(); }}
        />
      )}
    </>
  );
}
