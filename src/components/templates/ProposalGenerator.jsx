// Proposal generator. Fill the variable fields (client, address, summary, fees);
// the scope phases, exclusions, payment terms, and binding clause are baked into
// the PDF renderer. Right pane shows the assembled PDF (proposal + attachments).
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { todayIso, dotDate } from '../../lib/doc-format.js';
import { loadTrimmedLogo, imageToJpegBytes } from '../../lib/doc-assets.js';
import { deliverPdf } from '../../lib/deliver.js';
import {
  buildProposalPdf, STANDARD_PHASES, DEFAULT_FEE_ITEMS, DEFAULT_RE, DEFAULT_INTRO,
} from '../../lib/proposal-pdf.js';

let UID = 0;
const FIRM_SIGNERS = ['Thomas Dores, RA', 'Angelena Hreczny'];
const DEFAULT_INCLUDE = { survey: true, design: true, cd: true, ca: false };
const DEFAULT_FEE_INCLUDE = { survey: true, dp1: true, dp2: true, cd: true, ca: false };

// Editable scope phases, seeded from the standard set. Deliverables are held as
// newline-separated text (one bullet per line) so they're easy to hand-edit.
function seedPhases() {
  return STANDARD_PHASES.map((p) => ({
    id: ++UID,
    title: p.title,
    desc: p.desc.replace('{meetings}', '3'),
    deliverables: p.deliverables.join('\n'),
    included: DEFAULT_INCLUDE[p.key] ?? true,
  }));
}

export default function ProposalGenerator() {
  const [jobs, setJobs] = useState(null);
  const [jobId, setJobId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState('Proposal');
  const [title, setTitle] = useState('');
  const [projectType, setProjectType] = useState('Addition / Renovation');
  const [projectAddress, setProjectAddress] = useState('');
  const [attn, setAttn] = useState('');
  const [reSubject, setReSubject] = useState(DEFAULT_RE);
  const [greeting, setGreeting] = useState('');
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [projectSummary, setProjectSummary] = useState('');
  const [phases, setPhases] = useState(seedPhases);
  const [fees, setFees] = useState(DEFAULT_FEE_ITEMS.map((f) => ({ ...f, included: DEFAULT_FEE_INCLUDE[f.key] })));
  const [addl, setAddl] = useState([]);
  const [clientSigners, setClientSigners] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [logo, setLogo] = useState(null);

  const [currentId, setCurrentId] = useState(null);
  const [status, setStatus] = useState('draft');
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [pdfUrl, setPdfUrl] = useState(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');
  const imgInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const lastUrl = useRef(null);
  const lastBytes = useRef(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/jobs').then((r) => r.json())
      .then(({ jobs }) => alive && setJobs((jobs || []).slice().sort((a, b) => (a.job_id || '').localeCompare(b.job_id || ''))))
      .catch(() => alive && setJobs([]));
    loadTrimmedLogo().then((l) => alive && setLogo(l)).catch(() => {});
    refreshSaved();
    return () => { alive = false; };
  }, []);

  const refreshSaved = () => apiFetch('/api/proposals').then((r) => r.json())
    .then((d) => setSaved(d.proposals || [])).catch(() => {});

  const total = fees.filter((f) => f.included).reduce((s, f) => s + (Number(f.amount) || 0), 0);

  useEffect(() => {
    setSavedMsg(''); setSentMsg('');
    const t = setTimeout(async () => {
      setBuilding(true); setError(null);
      try {
        const clientNames = clientSigners.split('\n').map((s) => s.trim()).filter(Boolean);
        const bytes = await buildProposalPdf({
          date, label, title, projectType, projectAddress, attn, reSubject, greeting, intro, projectSummary,
          phases: phases.filter((p) => p.included).map((p) => ({
            title: p.title,
            desc: p.desc,
            deliverables: p.deliverables.split('\n').map((s) => s.trim()).filter(Boolean),
          })),
          feeItems: fees.filter((f) => f.included).map(({ label: l, amount, due }) => ({ label: l, amount: Number(amount) || 0, due })),
          additionalServices: addl.filter((a) => a.label).map((a) => ({ label: a.label, amount: Number(a.amount) || 0 })),
          signers: [...clientNames, ...FIRM_SIGNERS],
          attachments, logo,
        });
        lastBytes.current = bytes;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setPdfUrl(url);
      } catch (e) {
        setError(e.message || 'Could not build the PDF');
      } finally { setBuilding(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [date, label, title, projectType, projectAddress, attn, reSubject, greeting, intro, projectSummary, phases, fees, addl, clientSigners, attachments, logo]);

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  const pickJob = (id) => {
    setJobId(id);
    const job = (jobs || []).find((j) => j.job_id === id);
    if (!job) return;
    if (job.address) setProjectAddress(job.address);
    if (job.client_name) {
      setClientSigners((prev) => prev || job.client_name);
      setGreeting((prev) => prev || job.client_name.split(/\s+/)[0]);
      setTitle((prev) => prev || job.client_name.toUpperCase());
    }
  };

  // ── Save / reopen (fields-only; attachments + PDF are not persisted) ──
  const collectForm = () => ({ jobId, date, label, title, projectType, projectAddress, attn, reSubject, greeting, intro, projectSummary, phases, fees, addl, clientSigners });
  const applyForm = (c = {}) => {
    setDate(c.date || todayIso()); setLabel(c.label || 'Proposal'); setTitle(c.title || '');
    setProjectType(c.projectType || 'Addition / Renovation'); setProjectAddress(c.projectAddress || '');
    setAttn(c.attn || ''); setReSubject(c.reSubject || DEFAULT_RE); setGreeting(c.greeting || '');
    setIntro(c.intro || DEFAULT_INTRO); setProjectSummary(c.projectSummary || '');
    setPhases(Array.isArray(c.phases) && c.phases.length ? c.phases : seedPhases());
    setFees(Array.isArray(c.fees) && c.fees.length ? c.fees : DEFAULT_FEE_ITEMS.map((f) => ({ ...f, included: DEFAULT_FEE_INCLUDE[f.key] })));
    setAddl(Array.isArray(c.addl) ? c.addl : []);
    setClientSigners(c.clientSigners || '');
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await apiFetch('/api/proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId, job_id: jobId || null, status, content: collectForm() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setCurrentId(d.proposal.id);
      setSavedMsg('Saved ✓');
      refreshSaved();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const openSaved = async (id) => {
    if (!id) return;
    setError(null);
    try {
      const r = await apiFetch(`/api/proposals?id=${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open proposal');
      applyForm(d.proposal.content || {});
      setCurrentId(d.proposal.id);
      setStatus(d.proposal.status || 'draft');
      setJobId(d.proposal.job_id || '');
      setAttachments([]);
    } catch (e) { setError(e.message); }
  };

  const newProposal = () => { applyForm({}); setJobId(''); setStatus('draft'); setCurrentId(null); setAttachments([]); };

  const deleteSaved = async () => {
    if (!currentId || !window.confirm('Delete this saved proposal? This cannot be undone.')) return;
    try {
      const r = await apiFetch('/api/proposals', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Delete failed'); }
      newProposal(); refreshSaved();
    } catch (e) { setError(e.message); }
  };

  const setPhase = (id, patch) => setPhases((p) => p.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)));
  const addPhase = () => setPhases((p) => [...p, { id: ++UID, title: '', desc: '', deliverables: '', included: true }]);
  const removePhase = (id) => setPhases((p) => p.filter((ph) => ph.id !== id));

  const setFee = (key, patch) => setFees((p) => p.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const addService = () => setAddl((p) => [...p, { id: ++UID, label: '', amount: '' }]);
  const setService = (id, patch) => setAddl((p) => p.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeService = (id) => setAddl((p) => p.filter((a) => a.id !== id));

  const addImages = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    for (const file of files) {
      try { const bytes = await imageToJpegBytes(file); setAttachments((p) => [...p, { id: ++UID, kind: 'image', name: file.name, bytes, mime: 'image/jpeg' }]); }
      catch { setError(`Could not read image “${file.name}”`); }
    }
  };
  const addPdf = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { const bytes = new Uint8Array(await file.arrayBuffer()); setAttachments((p) => [...p, { id: ++UID, kind: 'pdf', name: file.name, bytes, mime: 'application/pdf' }]); }
    catch { setError(`Could not read PDF “${file.name}”`); }
  };
  const removeAtt = (id) => setAttachments((p) => p.filter((a) => a.id !== id));
  const moveAtt = (id, dir) => setAttachments((p) => {
    const i = p.findIndex((a) => a.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = p.slice(); [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const download = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `Proposal_${jobId || (title || 'proposal').replace(/\s+/g, '_')}.pdf`;
    a.click();
  };

  // Deliver the assembled PDF into the job's Drive "Proposal" folder.
  const sendToDrive = async () => {
    if (!jobId || !lastBytes.current) return;
    setSending(true); setError(null); setSentMsg('');
    try {
      const { folder } = await deliverPdf({
        jobId, kind: 'proposal',
        filename: `Proposal ${dotDate(date)}.pdf`,
        bytes: lastBytes.current,
      });
      setSentMsg(`Sent to ${folder} ✓`);
    } catch (e) { setError(e.message); } finally { setSending(false); }
  };

  return (
    <div className="page tpl-gen-page">
      <div className="tpl-gen-bar">
        <Link to="/templates" className="fn-link">← Templates</Link>
        <div className="tpl-gen-bar-right">
          <select className="tpl-open" value="" onChange={(e) => { openSaved(e.target.value); e.target.value = ''; }}>
            <option value="">Open saved…</option>
            {saved.map((s) => <option key={s.id} value={s.id}>{s.title}{s.status !== 'draft' ? ` (${s.status})` : ''}</option>)}
          </select>
          <button className="sr-btn ghost" onClick={newProposal}>New</button>
          {currentId && <button className="sr-btn ghost" onClick={deleteSaved}>Delete</button>}
          {savedMsg && <span className="tpl-status">{savedMsg}</span>}
          {sentMsg && <span className="tpl-status">{sentMsg}</span>}
          {building && <span className="tpl-status">Building…</span>}
          <button className="sr-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="sr-btn" onClick={download} disabled={!pdfUrl}>Download PDF</button>
          <button
            className="sr-btn"
            onClick={sendToDrive}
            disabled={sending || !pdfUrl || !jobId}
            title={jobId ? 'File this proposal in the job’s Drive “Proposal” folder' : 'Select a job first'}
          >
            {sending ? 'Sending…' : 'Send to Proposal folder'}
          </button>
        </div>
      </div>

      <div className="tpl-gen">
        <div className="tpl-form">
          <h2 className="tpl-form-title">Proposal</h2>

          <label className="tpl-field">
            <span>Job (prefills client + address)</span>
            <select value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">— none —</option>
              {(jobs || []).map((j) => <option key={j.job_id} value={j.job_id}>{j.job_id}{j.client_name ? ` — ${j.client_name}` : ''}</option>)}
            </select>
          </label>

          <div className="tpl-row">
            <label className="tpl-field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="tpl-field"><span>Label</span>
              <select value={label} onChange={(e) => setLabel(e.target.value)}>
                <option>Proposal</option><option>Revised Proposal</option>
              </select>
            </label>
            <label className="tpl-field"><span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="draft">draft</option><option value="sent">sent</option><option value="signed">signed</option>
              </select>
            </label>
          </div>

          <label className="tpl-field"><span>Title (e.g. KUHN RESIDENCE)</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="KUHN RESIDENCE" /></label>
          <div className="tpl-row">
            <label className="tpl-field"><span>Project type</span><input value={projectType} onChange={(e) => setProjectType(e.target.value)} placeholder="Addition / Renovation" /></label>
            <label className="tpl-field"><span>Project address</span><input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} placeholder="352 Amherst Street | Wyckoff, NJ 07481" /></label>
          </div>
          <label className="tpl-field"><span>Re:</span><input value={reSubject} onChange={(e) => setReSubject(e.target.value)} /></label>
          <div className="tpl-row">
            <label className="tpl-field"><span>Attn (optional)</span><input value={attn} onChange={(e) => setAttn(e.target.value)} placeholder="Jonathan Rodriguez" /></label>
            <label className="tpl-field"><span>Greeting (Dear …)</span><input value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Randy" /></label>
          </div>
          <label className="tpl-field"><span>Intro paragraph</span><textarea rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} /></label>
          <label className="tpl-field"><span>Project summary</span><textarea rows={3} value={projectSummary} onChange={(e) => setProjectSummary(e.target.value)} placeholder="The existing house will undergo interior renovations and a 2-story addition…" /></label>

          <div className="tpl-field-group">Scope of services — edit freely (deliverables = one bullet per line)</div>
          {phases.map((p) => (
            <div key={p.id} className="tpl-phase">
              <div className="tpl-phase-head">
                <input type="checkbox" checked={p.included} onChange={(e) => setPhase(p.id, { included: e.target.checked })} aria-label="Include phase" />
                <input className="tpl-phase-title" value={p.title} onChange={(e) => setPhase(p.id, { title: e.target.value })} placeholder="Phase title" />
                <button type="button" className="tpl-x" onClick={() => removePhase(p.id)} aria-label="Remove phase">✕</button>
              </div>
              {p.included && (
                <>
                  <textarea className="tpl-phase-area" rows={2} value={p.desc} onChange={(e) => setPhase(p.id, { desc: e.target.value })} placeholder="Description of this phase…" />
                  <textarea className="tpl-phase-area" rows={3} value={p.deliverables} onChange={(e) => setPhase(p.id, { deliverables: e.target.value })} placeholder={'Deliverables — one per line\nExisting floor plans\nProposed elevations'} />
                </>
              )}
            </div>
          ))}
          <button type="button" className="tpl-att-btn" onClick={addPhase}>+ Add phase</button>

          <div className="tpl-field-group">Fee schedule — total {moneyLabel(total)}</div>
          {fees.map((f) => (
            <div key={f.key} className="tpl-fee">
              <label className="tpl-check tpl-fee-inc">
                <input type="checkbox" checked={f.included} onChange={(e) => setFee(f.key, { included: e.target.checked })} />
                <span>{f.label}</span>
              </label>
              <input type="number" className="tpl-fee-amt" value={f.amount} disabled={!f.included} onChange={(e) => setFee(f.key, { amount: e.target.value })} />
            </div>
          ))}

          <div className="tpl-field-group">Additional services (optional)</div>
          {addl.map((a) => (
            <div key={a.id} className="tpl-fee">
              <input className="tpl-fee-inc" value={a.label} placeholder="3D Model + Render of spaces" onChange={(e) => setService(a.id, { label: e.target.value })} />
              <input type="number" className="tpl-fee-amt" value={a.amount} placeholder="2000" onChange={(e) => setService(a.id, { amount: e.target.value })} />
              <button type="button" className="tpl-att-ctrls" onClick={() => removeService(a.id)} aria-label="Remove" style={{ border: '1px solid var(--border)', borderRadius: 5, width: 24 }}>✕</button>
            </div>
          ))}
          <button type="button" className="tpl-att-btn" onClick={addService}>+ Add service</button>

          <label className="tpl-field"><span>Client signer(s) — one name per line</span>
            <textarea rows={2} value={clientSigners} onChange={(e) => setClientSigners(e.target.value)} placeholder={'Randy Kuhn'} />
          </label>
          <div className="tpl-note">Thomas Dores, RA and Angelena Hreczny are added as signers automatically.</div>

          <div className="tpl-field-group">Attachments / extra pages</div>
          <div className="tpl-note">Attachments aren’t saved with the proposal — re-add them when you reopen.</div>
          <div className="tpl-att-actions">
            <button type="button" className="tpl-att-btn" onClick={() => imgInputRef.current?.click()}>+ Image</button>
            <button type="button" className="tpl-att-btn" onClick={() => pdfInputRef.current?.click()}>+ Reference PDF</button>
            <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={addImages} />
            <input ref={pdfInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={addPdf} />
          </div>
          {attachments.length > 0 && (
            <ul className="tpl-att-list">
              {attachments.map((a, i) => (
                <li key={a.id} className="tpl-att-item">
                  <span className="tpl-att-kind">{a.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
                  <span className="tpl-att-name" title={a.name}>{a.name}</span>
                  <span className="tpl-att-ctrls">
                    <button type="button" onClick={() => moveAtt(a.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" onClick={() => moveAtt(a.id, 1)} disabled={i === attachments.length - 1} aria-label="Move down">↓</button>
                    <button type="button" className="danger" onClick={() => removeAtt(a.id)} aria-label="Remove">✕</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="fn-error">{error}</div>}
        </div>

        <div className="tpl-preview">
          {pdfUrl
            ? <iframe className="tpl-pdf-frame" src={`${pdfUrl}#toolbar=0&navpanes=0`} title="Proposal preview" />
            : <div className="tpl-pdf-empty">Building preview…</div>}
        </div>
      </div>
    </div>
  );
}

function moneyLabel(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}
