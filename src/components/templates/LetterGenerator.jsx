// Building-department letter generator. Pick a job (prefills the project
// address), fill the department + body fields, and the right pane renders a
// print-ready letter. "Print / Save as PDF" uses the browser print dialog;
// @media print hides the app chrome + the form and prints only the letter.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api.js';
import { longDateOnly, todayIso, parseBodyBlocks } from '../../lib/doc-format.js';
import Letterhead from './Letterhead.jsx';

const DEFAULT_CLOSING =
  'If there are any questions regarding this item, please do not hesitate to contact me.';
const DEFAULT_SIGNER = 'Thomas Dores, RA';

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

  useEffect(() => {
    let alive = true;
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then(({ jobs }) => {
        if (!alive) return;
        setJobs((jobs || []).slice().sort((a, b) => (a.job_id || '').localeCompare(b.job_id || '')));
      })
      .catch(() => alive && setJobs([]));
    return () => { alive = false; };
  }, []);

  // Picking a job prefills the project address from its record (editable).
  const pickJob = (id) => {
    setJobId(id);
    const job = (jobs || []).find((j) => j.job_id === id);
    if (job?.address) setProjectAddress(job.address);
  };

  const bodyBlocks = useMemo(() => parseBodyBlocks(body), [body]);

  return (
    <div className="page tpl-gen-page">
      <div className="tpl-gen-bar no-print">
        <Link to="/templates" className="fn-link">← Templates</Link>
        <button className="sr-btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="tpl-gen">
        {/* ── Form ── */}
        <div className="tpl-form no-print">
          <h2 className="tpl-form-title">Building-Dept Letter</h2>

          <label className="tpl-field">
            <span>Job (prefills project address)</span>
            <select value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">— none / type address below —</option>
              {(jobs || []).map((j) => (
                <option key={j.job_id} value={j.job_id}>
                  {j.job_id}{j.client_name ? ` — ${j.client_name}` : ''}
                </option>
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
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'- All areas with Headers and Beams to be reinforced with triple posts\n- Contractor to verify in field…\n\nFurthermore, framing revisions are included as an attachment.'}
            />
          </label>

          <label className="tpl-field">
            <span>Closing line</span>
            <textarea rows={2} value={closing} onChange={(e) => setClosing(e.target.value)} />
          </label>
          <label className="tpl-field">
            <span>Signed by</span>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} />
          </label>
        </div>

        {/* ── Live preview (the printed letter) ── */}
        <div className="tpl-preview">
          <div className="doc-paper">
            <Letterhead />

            <div className="doc-date">{longDateOnly(date)}</div>

            <div className="doc-recipient">
              {deptName && <div>{deptName}</div>}
              {deptStreet && <div>{deptStreet}</div>}
              {deptCityStateZip && <div>{deptCityStateZip}</div>}
              {reference && <div>Reference: {reference}</div>}
            </div>

            {projectAddress && <div className="doc-project-addr">{projectAddress}</div>}

            <div className="doc-greeting">To Whom It May Concern,</div>

            <div className="doc-body">
              {bodyBlocks.length === 0 && <p className="doc-placeholder">Letter body will appear here…</p>}
              {bodyBlocks.map((b, i) =>
                b.type === 'bullets' ? (
                  <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                ) : (
                  <p key={i}>{b.text}</p>
                ),
              )}
            </div>

            {closing && <p className="doc-closing">{closing}</p>}

            <div className="doc-signoff">
              <div>Sincerely,</div>
              <div className="doc-signer">{signer}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
