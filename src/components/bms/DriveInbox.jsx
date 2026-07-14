// "New in Drive" — jobs and leads foldered in Drive that the app doesn't have yet.
//
// Ray, Ang and Tom each start work differently: often the Drive folder exists weeks
// before anything reaches the app. This strip closes that gap without letting Drive
// write to the board on its own — a folder name carries no phase, no client and no
// contract value, and the Job ID is what QuickBooks matches on, so each one is added
// by a person, not a cron.
//
// It renders NOTHING when the queue is empty, which is the normal state.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { PHASE_LABELS, PHASE_ORDER } from '../../lib/format.js';

export default function DriveInbox({ onImported }) {
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // folderId being acted on
  const [error, setError] = useState(null);
  const [phases, setPhases] = useState({}); // folderId -> chosen phase

  async function load() {
    try {
      const res = await apiFetch('/api/drive/new-folders');
      if (!res.ok) return;
      const d = await res.json();
      setQueue(d.queue || []);
    } catch {
      // A Drive hiccup must never break the board — the strip just stays hidden.
    }
  }

  useEffect(() => { load(); }, []);

  async function act(hit, body) {
    setBusy(hit.folderId);
    setError(null);
    try {
      const res = await apiFetch('/api/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: hit.folderId, folder_name: hit.folderName, ...body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setQueue((q) => q.filter((x) => x.folderId !== hit.folderId));
      if (!body.dismiss) onImported?.(d.job);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!queue.length) return null;

  const jobs = queue.filter((q) => q.kind === 'job').length;
  const leads = queue.length - jobs;

  return (
    <div className="drive-inbox">
      <button className="di-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="di-badge">{queue.length}</span>
        <span className="di-title">
          New in Drive — {jobs > 0 && `${jobs} job${jobs === 1 ? '' : 's'}`}
          {jobs > 0 && leads > 0 && ' · '}
          {leads > 0 && `${leads} lead${leads === 1 ? '' : 's'}`}
        </span>
        <span className="di-sub">foldered in Drive, not in the app yet</span>
        <span className="di-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="di-body">
          {error && <div className="di-error">{error}</div>}
          {queue.map((hit) => (
            <div key={hit.folderId} className={`di-row${hit.valid ? '' : ' invalid'}`}>
              <div className="di-main">
                <div className="di-name">
                  <span className={`di-kind ${hit.kind}`}>{hit.kind === 'lead' ? 'LEAD' : 'JOB'}</span>
                  {hit.folderName}
                  {hit.isForefront && <span className="badge badge-ff">FF</span>}
                </div>
                <div className="di-meta">
                  {hit.clientName && <>Client looks like <strong>{hit.clientName}</strong> · </>}
                  created {String(hit.createdTime).slice(0, 10)}
                </div>
                {hit.problem && <div className="di-problem">{hit.problem}</div>}
              </div>

              {hit.valid && (
                <div className="di-actions">
                  <select
                    value={phases[hit.folderId] || hit.suggestedPhase}
                    onChange={(e) => setPhases((p) => ({ ...p, [hit.folderId]: e.target.value }))}
                    aria-label="Phase"
                  >
                    {PHASE_ORDER.map((p) => (
                      <option key={p} value={p}>{PHASE_LABELS[p]}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={busy === hit.folderId}
                    onClick={() => act(hit, { phase: phases[hit.folderId] || hit.suggestedPhase })}
                  >
                    {busy === hit.folderId ? 'Adding…' : 'Add to app'}
                  </button>
                </div>
              )}
              <button
                className="di-dismiss"
                disabled={busy === hit.folderId}
                onClick={() => act(hit, { dismiss: true })}
                title="Not a job — stop showing this folder"
              >
                Ignore
              </button>
            </div>
          ))}
          <div className="di-note">
            Adding a folder creates the job with the client <em>unlinked</em> and no contract total —
            open it and fill those in. A lead keeps its <code>XXX</code> placeholder until its proposal
            is signed, then the app numbers it and renames the Drive folder for you.
          </div>
        </div>
      )}
    </div>
  );
}
