// Signed-proposal viewer — surfaces the job's proposal PDF(s) from its Drive
// "Proposal" folder so staff can read the contract (the authoritative fee schedule)
// right where they invoice. The PDF is fetched through the staff-gated backend
// (which brokers Drive) as a blob, so auth rides on the fetch and the bytes render
// in an inline iframe. Renders nothing when there's no proposal on file.
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { shortDate, fileSize } from '../../lib/format.js';

export default function ProposalDocs({ job }) {
  const [state, setState] = useState({ loading: true });
  const [openId, setOpenId] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewErr, setViewErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      try {
        const res = await apiFetch(`/api/jobs/proposal-docs?jobId=${encodeURIComponent(job.job_id)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (alive) setState({ loading: false, ...data });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message });
      }
    })();
    return () => { alive = false; };
  }, [job.job_id]);

  // Free the blob URL when it's replaced or the panel unmounts — the effect
  // cleanup is the single revoke path (view() only ever sets the state).
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  // ⚠️ Set to TRUE on mount, not just false on unmount. StrictMode deliberately mounts →
  // unmounts → remounts in dev; a ref that only ever flips to false stays false after that
  // remount, so every view() below bailed at its `if (!mounted.current)` guard and the panel
  // sat on "Loading proposal…" forever. (Dev-only — prod doesn't double-invoke — which is
  // exactly why it went unnoticed.)
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function view(file) {
    if (openId === file.id) { // toggle closed
      setOpenId(null);
      setBlobUrl(null);
      return;
    }
    setViewErr(null);
    setViewLoading(true);
    setOpenId(file.id);
    setBlobUrl(null);
    try {
      const res = await apiFetch(
        `/api/jobs/proposal-docs?jobId=${encodeURIComponent(job.job_id)}&fileId=${encodeURIComponent(file.id)}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Unmounted mid-fetch: the cleanup effect never saw this URL, revoke it here.
      if (!mounted.current) { URL.revokeObjectURL(url); return; }
      setBlobUrl(url);
    } catch (err) {
      if (!mounted.current) return;
      setViewErr(err.message);
      setOpenId(null);
    } finally {
      if (mounted.current) setViewLoading(false);
    }
  }

  if (state.loading || state.error) return null; // stay quiet until known; a Drive hiccup shouldn't clutter billing
  const files = state.files || [];
  if (files.length === 0) return null;

  return (
    <div className="proposal-docs">
      <div className="pay-form-title">Signed proposal</div>
      <div className="placeholder-note" style={{ padding: '0 0 8px' }}>
        The contract on file (from this job’s Drive “Proposal” folder) — your source for the fee schedule.
      </div>
      <ul className="pdoc-list">
        {files.map((f) => (
          <li key={f.id} className="pdoc-row">
            <span className="pdoc-icon">▧</span>
            <div className="pdoc-main">
              <span className="pdoc-name">{f.name}</span>
              <span className="pdoc-meta">{[f.modifiedTime && shortDate(f.modifiedTime), fileSize(f.size)].filter(Boolean).join(' · ')}</span>
            </div>
            {f.viewable
              ? <button type="button" className="chip" onClick={() => view(f)}>{openId === f.id ? 'Hide' : 'View'}</button>
              : <span className="pdoc-meta">not previewable</span>}
          </li>
        ))}
      </ul>
      {viewErr && <div className="error" style={{ marginTop: 8 }}>{viewErr}</div>}
      {openId && (
        <div className="pdoc-viewer">
          {viewLoading ? (
            <div className="empty">Loading proposal…</div>
          ) : blobUrl ? (
            <>
              <iframe title="Signed proposal" src={blobUrl} className="pdoc-frame" />
              <a href={blobUrl} target="_blank" rel="noreferrer" className="chip pdoc-open">Open full screen ↗</a>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
