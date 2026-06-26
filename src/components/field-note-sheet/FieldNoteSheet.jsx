// Mobile "Field note" bottom sheet — capture an on-site note against a job.
// The README's main mobile feature. Pick a job, type a note and/or attach a
// photo, voice memo, or GPS location, then save → POST /api/field-notes. Recent
// notes for the job are shown to confirm the save.
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../../lib/api.js';
import { phaseLabel, shortDate } from '../../lib/format.js';
import { NoteMedia } from '../../lib/note-media.jsx';

// --- device-capture helpers ---

// Read a File/Blob as a base64 data URL.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// Downscale a photo to a max dimension and re-encode as JPEG, so uploads stay
// small/fast (phones shoot multi-MB images). Also normalizes iOS HEIC → JPEG.
async function imageFileToDataUrl(file, maxDim = 1600, quality = 0.8) {
  const src = await blobToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

// First audio container the browser will actually record (iOS Safari → mp4).
function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/mp4', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export default function FieldNoteSheet({ onClose }) {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState(null);          // null = loading
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);  // job_id
  const [body, setBody] = useState('');
  const [notes, setNotes] = useState([]);          // recent notes for selected job
  const [attachments, setAttachments] = useState([]); // pending, unsaved: {type,path,name,preview}
  const [location, setLocation] = useState(null);  // pending {lat,lng}
  const [uploading, setUploading] = useState(null); // 'photo' | 'voice' | 'location' | null
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null); // note being edited
  const [editText, setEditText] = useState('');
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // All jobs — site visits happen on completed/on-hold work too (inspectors,
  // construction issues), so don't restrict by phase.
  useEffect(() => {
    let alive = true;
    apiFetch('/api/jobs')
      .then((r) => r.json())
      .then(({ jobs }) => {
        if (!alive) return;
        const all = (jobs || []).sort((a, b) => (a.job_id || '').localeCompare(b.job_id || ''));
        setJobs(all);
      })
      .catch(() => alive && setJobs([]));
    return () => { alive = false; };
  }, []);

  // Load the selected job's recent notes (also confirms a save landed).
  const loadNotes = async (jobId) => {
    try {
      const token = await getToken();
      const r = await fetch(`/api/field-notes?job_id=${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      setNotes(d.notes || []);
    } catch {
      setNotes([]);
    }
  };

  // Switching jobs resets pending capture — attachments are stored under the job.
  const pickJob = (jobId) => {
    setSelected(jobId);
    setError(null);
    setNotes([]);
    setAttachments([]);
    setLocation(null);
    loadNotes(jobId);
  };

  // Push a captured photo/voice blob to Storage, keep a local preview for the chip.
  const uploadAttachment = async (kind, dataUrl, name) => {
    setUploading(kind);
    setError(null);
    try {
      const token = await getToken();
      const r = await fetch('/api/field-notes/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ job_id: selected, kind, dataUrl, name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      setAttachments((p) => [...p, { type: d.type, path: d.path, name: d.name, preview: dataUrl }]);
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const onPhotoFile = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file(s)
    if (!files.length || !selected) return;
    // Upload sequentially so each lands as its own attachment.
    for (const file of files) {
      try {
        const dataUrl = await imageFileToDataUrl(file);
        await uploadAttachment('photo', dataUrl, file.name);
      } catch {
        setError('Could not read that image');
      }
    }
  };

  const toggleVoice = async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    if (!selected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/mp4' });
        try {
          const dataUrl = await blobToDataUrl(blob);
          await uploadAttachment('voice', dataUrl, 'voice-note');
        } catch {
          setError('Could not save that recording');
        }
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setError('Microphone unavailable or permission denied');
    }
  };

  const captureLocation = () => {
    if (!navigator.geolocation) { setError('Location is not available on this device'); return; }
    setUploading('location');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setUploading(null); },
      () => { setError('Could not get your location (permission denied?)'); setUploading(null); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const removeAttachment = (idx) => setAttachments((p) => p.filter((_, i) => i !== idx));

  const busy = saving || Boolean(uploading) || recording;
  const canSave = Boolean(selected) && (body.trim().length > 0 || attachments.length > 0 || Boolean(location)) && !busy;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const r = await fetch('/api/field-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          job_id: selected,
          body: body.trim(),
          attachments: attachments.map(({ type, path, name }) => ({ type, path, name })),
          location,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save the note');
      if (d.note) setNotes((prev) => [d.note, ...prev]);
      setBody('');
      setAttachments([]);
      setLocation(null);
    } catch (e) {
      setError(e.message || 'Could not save the note');
    } finally {
      setSaving(false);
    }
  };

  // Edit / delete an existing note.
  const startEdit = (n) => { setEditingId(n.id); setEditText(n.body || ''); setError(null); };
  const cancelEdit = () => { setEditingId(null); setEditText(''); };
  const saveEdit = async (id) => {
    try {
      const token = await getToken();
      const r = await fetch('/api/field-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, body: editText.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not update the note');
      setNotes((prev) => prev.map((n) => (n.id === id ? d.note : n)));
      cancelEdit();
    } catch (e) {
      setError(e.message || 'Could not update the note');
    }
  };
  const removeNote = async (id) => {
    if (!window.confirm('Delete this field note? This cannot be undone.')) return;
    try {
      const token = await getToken();
      const r = await fetch('/api/field-notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not delete the note');
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      setError(e.message || 'Could not delete the note');
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = (jobs || []).filter(
    (j) => !q || (j.job_id || '').toLowerCase().includes(q) || (j.client_name || '').toLowerCase().includes(q),
  );

  const TOOLS = [
    { key: 'photo', label: uploading === 'photo' ? 'Uploading…' : 'Photo', icon: 'M4 7h3l1.5-2h7L17 7h3v12H4z M12 16a3 3 0 100-6 3 3 0 000 6z', onClick: () => fileInputRef.current?.click() },
    { key: 'voice', label: recording ? 'Stop' : uploading === 'voice' ? 'Uploading…' : 'Voice', icon: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z M5 11a7 7 0 0014 0 M12 18v3', onClick: toggleVoice },
    { key: 'location', label: uploading === 'location' ? 'Locating…' : location ? 'Pinned' : 'Location', icon: 'M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', onClick: captureLocation },
  ];

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New field note">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title">Field note</h2>
            <div className="sheet-sub">On-site capture</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Job picker */}
        <div className="fn-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            placeholder="Find a job…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a job"
          />
        </div>
        <div className="fn-joblist">
          {jobs == null && <div className="placeholder-note">Loading jobs…</div>}
          {jobs != null && filtered.length === 0 && (
            <div className="placeholder-note">No jobs match.</div>
          )}
          {filtered.map((j) => {
            const active = j.job_id === selected;
            return (
              <button
                key={j.job_id}
                className={`fn-job${active ? ' active' : ''}`}
                onClick={() => pickJob(j.job_id)}
              >
                <span className="fn-job-dot" />
                <span className="fn-job-main">
                  <span className="fn-job-id">{j.job_id}</span>
                  <span className="fn-job-meta">{j.client_name || '—'} · {phaseLabel(j)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Note body */}
        <textarea
          className="fn-body"
          placeholder={selected ? 'What did you observe on site?' : 'Pick a job first…'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={!selected}
          rows={4}
        />

        {/* Capture tools — camera, voice memo, GPS location */}
        {/* No `capture` attr → iOS offers Take Photo / Photo Library / Choose File;
            `multiple` allows selecting several from the library at once. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPhotoFile}
          style={{ display: 'none' }}
        />
        <div className="fn-attach">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              className={`fn-attach-btn${(t.key === 'voice' && recording) ? ' recording' : ''}${(t.key === 'location' && location) ? ' done' : ''}`}
              onClick={t.onClick}
              disabled={!selected || (busy && !(t.key === 'voice' && recording))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={t.icon} />
              </svg>
              <span className="fn-attach-label">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Pending capture preview (before save) */}
        {(attachments.length > 0 || location) && (
          <div className="fn-pending">
            {attachments.map((a, i) => (
              <div key={i} className="fn-pending-item">
                {a.type === 'photo'
                  ? <img className="fn-pending-thumb" src={a.preview} alt={a.name || 'photo'} />
                  : <span className="fn-pending-voice">🎙 voice memo</span>}
                <button className="fn-pending-x" onClick={() => removeAttachment(i)} aria-label="Remove">✕</button>
              </div>
            ))}
            {location && (
              <div className="fn-pending-item">
                <span className="fn-pending-voice">📍 {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>
                <button className="fn-pending-x" onClick={() => setLocation(null)} aria-label="Remove location">✕</button>
              </div>
            )}
          </div>
        )}

        {error && <div className="fn-error">{error}</div>}

        <button className="fn-save" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save field note'}
        </button>

        {/* Recent notes for the selected job */}
        {selected && notes.length > 0 && (
          <div className="fn-recent">
            <div className="fn-recent-cap">Recent notes</div>
            {notes.slice(0, 5).map((n) => (
              <div key={n.id} className="fn-recent-item">
                <div className="fn-recent-main">
                  {editingId === n.id ? (
                    <>
                      <textarea className="fn-body" rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} />
                      <div className="fn-note-actions">
                        <button className="fn-link" onClick={() => saveEdit(n.id)}>Save</button>
                        <button className="fn-link muted" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      {n.body && <div className="fn-recent-body">{n.body}</div>}
                      <NoteMedia attachments={n.attachments} location={n.location} />
                      <div className="fn-note-actions">
                        <button className="fn-link" onClick={() => startEdit(n)}>Edit</button>
                        <button className="fn-link danger" onClick={() => removeNote(n.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="fn-recent-date">{shortDate(n.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
