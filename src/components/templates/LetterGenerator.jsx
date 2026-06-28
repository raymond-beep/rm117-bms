// Building-department letter generator. Fill the fields + attach images / a
// reference PDF; the right pane shows the assembled PDF (letter + attachment
// pages, merged) in an iframe. "Download PDF" saves that exact file.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { todayIso, dotDate } from '../../lib/doc-format.js';
import { buildLetterPdf } from '../../lib/letter-pdf.js';
import { loadTrimmedLogo, imageToJpegBytes } from '../../lib/doc-assets.js';
import { deliverPdf } from '../../lib/deliver.js';

const DEFAULT_CLOSING =
  'If there are any questions regarding this item, please do not hesitate to contact me.';
const DEFAULT_SIGNER = 'Thomas Dores, RA';
let UID = 0;

export default function LetterGenerator() {
  const [jobs, setJobs] = useState(null);
  const [jobId, setJobId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [deptName, setDeptName] = useState('');
  const [deptStreet, setDeptStreet] = useState('');
  const [deptCityStateZip, setDeptCityStateZip] = useState('');
  const [reference, setReference] = useState('Addition / Renovation');
  const [projectAddress, setProjectAddress] = useState('');
  const [body, setBody] = useState('');
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [signer, setSigner] = useState(DEFAULT_SIGNER);
  const [attachments, setAttachments] = useState([]); // {id, kind, name, bytes, mime}
  const [logo, setLogo] = useState(null);

  const [currentId, setCurrentId] = useState(null);
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
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then(({ jobs }) => alive && setJobs((jobs || []).slice().sort((a, b) => (a.job_id || '').localeCompare(b.job_id || ''))))
      .catch(() => alive && setJobs([]));
    loadTrimmedLogo().then((l) => alive && setLogo(l)).catch(() => {});
    refreshSaved();
    return () => { alive = false; };
  }, []);

  const refreshSaved = () => apiFetch('/api/letters').then((r) => r.json())
    .then((d) => setSaved(d.letters || [])).catch(() => {});

  // Rebuild the preview PDF (debounced) whenever the letter or attachments change.
  useEffect(() => {
    setSavedMsg(''); setSentMsg('');
    const t = setTimeout(async () => {
      setBuilding(true); setError(null);
      try {
        const bytes = await buildLetterPdf({
          date, deptName, deptStreet, deptCityStateZip, reference, projectAddress, body, closing, signer, attachments, logo,
        });
        lastBytes.current = bytes;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setPdfUrl(url);
      } catch (e) {
        setError(e.message || 'Could not build the PDF');
      } finally {
        setBuilding(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [date, deptName, deptStreet, deptCityStateZip, reference, projectAddress, body, closing, signer, attachments, logo]);

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  const pickJob = (id) => {
    setJobId(id);
    const job = (jobs || []).find((j) => j.job_id === id);
    if (job?.address) setProjectAddress(job.address);
  };

  // ── Save / reopen (fields-only; attachments + PDF are not persisted) ──
  const collectForm = () => ({ jobId, date, deptName, deptStreet, deptCityStateZip, reference, projectAddress, body, closing, signer });
  const applyForm = (c = {}) => {
    setDate(c.date || todayIso());
    setDeptName(c.deptName || ''); setDeptStreet(c.deptStreet || ''); setDeptCityStateZip(c.deptCityStateZip || '');
    setReference(c.reference || 'Addition / Renovation'); setProjectAddress(c.projectAddress || '');
    setBody(c.body || ''); setClosing(c.closing || DEFAULT_CLOSING); setSigner(c.signer || DEFAULT_SIGNER);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await apiFetch('/api/letters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId, job_id: jobId || null, content: collectForm() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setCurrentId(d.letter.id);
      setSavedMsg('Saved ✓');
      refreshSaved();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const openSaved = async (id) => {
    if (!id) return;
    setError(null);
    try {
      const r = await apiFetch(`/api/letters?id=${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open letter');
      applyForm(d.letter.content || {});
      setCurrentId(d.letter.id);
      setJobId(d.letter.job_id || '');
      setAttachments([]);
    } catch (e) { setError(e.message); }
  };

  const newLetter = () => { applyForm({}); setJobId(''); setCurrentId(null); setAttachments([]); };

  const deleteSaved = async () => {
    if (!currentId || !window.confirm('Delete this saved letter? This cannot be undone.')) return;
    try {
      const r = await apiFetch('/api/letters', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Delete failed'); }
      newLetter(); refreshSaved();
    } catch (e) { setError(e.message); }
  };

  const addImages = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      try {
        const bytes = await imageToJpegBytes(file);
        setAttachments((p) => [...p, { id: ++UID, kind: 'image', name: file.name, bytes, mime: 'image/jpeg' }]);
      } catch { setError(`Could not read image “${file.name}”`); }
    }
  };

  const addPdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setAttachments((p) => [...p, { id: ++UID, kind: 'pdf', name: file.name, bytes, mime: 'application/pdf' }]);
    } catch { setError(`Could not read PDF “${file.name}”`); }
  };

  const removeAtt = (id) => setAttachments((p) => p.filter((a) => a.id !== id));
  const moveAtt = (id, dir) => setAttachments((p) => {
    const i = p.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = p.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const download = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    const base = jobId || deptName.replace(/\s+/g, '_') || 'letter';
    a.download = `Letter_${base}.pdf`;
    a.click();
  };

  // Deliver the assembled PDF into the job's Drive "Files Sent" folder.
  const sendToDrive = async () => {
    if (!jobId || !lastBytes.current) return;
    setSending(true); setError(null); setSentMsg('');
    try {
      const { folder } = await deliverPdf({
        jobId, kind: 'letter',
        filename: `Building Department Letter ${dotDate(date)}.pdf`,
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
            {saved.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <button className="sr-btn ghost" onClick={newLetter}>New</button>
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
            title={jobId ? 'File this letter in the job’s Drive “Files Sent” folder' : 'Select a job first'}
          >
            {sending ? 'Sending…' : 'Send to Files Sent'}
          </button>
        </div>
      </div>

      <div className="tpl-gen">
        <div className="tpl-form">
          <h2 className="tpl-form-title">Building-Dept Letter</h2>

          <label className="tpl-field">
            <span>Job (prefills project address)</span>
            <select value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">— none / type address below —</option>
              {(jobs || []).map((j) => (
                <option key={j.job_id} value={j.job_id}>{j.job_id}{j.client_name ? ` — ${j.client_name}` : ''}</option>
              ))}
            </select>
          </label>

          <label className="tpl-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <div className="tpl-field-group">Building department</div>
          <label className="tpl-field">
            <span>Department name</span>
            <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Toms River Building Department" />
          </label>
          <label className="tpl-field">
            <span>Street</span>
            <input value={deptStreet} onChange={(e) => setDeptStreet(e.target.value)} placeholder="33 Washington Street" />
          </label>
          <label className="tpl-field">
            <span>City, State ZIP</span>
            <input value={deptCityStateZip} onChange={(e) => setDeptCityStateZip(e.target.value)} placeholder="Toms River, NJ 08753" />
          </label>

          <label className="tpl-field">
            <span>Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Addition / Renovation" />
          </label>
          <label className="tpl-field">
            <span>Project address</span>
            <input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} placeholder="1570 Forrest Trail Circle" />
          </label>

          <label className="tpl-field">
            <span>Body — one item per line; start a line with “-” for a bullet</span>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={'- All areas with Headers and Beams to be reinforced with triple posts\n- Contractor to verify in field…\n\nFurthermore, framing revisions are included as an attachment.'} />
          </label>

          <label className="tpl-field">
            <span>Closing line</span>
            <textarea rows={2} value={closing} onChange={(e) => setClosing(e.target.value)} />
          </label>
          <label className="tpl-field">
            <span>Signed by</span>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} />
          </label>

          {/* Attachments — appended pages (images + reference PDFs) */}
          <div className="tpl-field-group">Attachments / extra pages</div>
          <div className="tpl-note">Attachments aren’t saved with the letter — re-add them when you reopen.</div>
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
            ? <iframe className="tpl-pdf-frame" src={`${pdfUrl}#toolbar=0&navpanes=0`} title="Letter preview" />
            : <div className="tpl-pdf-empty">Building preview…</div>}
        </div>
      </div>
    </div>
  );
}
