// Field notes (staff) — captured on-site via the mobile sheet; editable here.
// Rendered inside the Progress tab.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { shortDate } from '../../lib/format.js';
import { NoteMedia } from '../../lib/note-media.jsx';

export default function FieldNotesPanel({ job }) {
  const { getToken } = useAuth();
  const [notes, setNotes] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`/api/field-notes?job_id=${encodeURIComponent(job.job_id)}`, {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (alive) setNotes(d.notes || []);
      } catch {
        if (alive) setNotes([]);
      }
    })();
    return () => { alive = false; };
  }, [job.job_id, getToken]);

  const startEdit = (n) => { setEditingId(n.id); setEditText(n.body || ''); setError(null); };
  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  async function saveEdit(id) {
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
      setError(e.message);
    }
  }

  async function removeNote(id) {
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
      setError(e.message);
    }
  }

  return (
    <div className="fnp">
      <div className="pay-form-title">Field notes</div>
      <div className="placeholder-note" style={{ padding: '0 0 10px' }}>
        Captured on-site from the mobile app (photo, voice, and location). Edit or delete as needed.
      </div>
      {error && <div className="fn-error" style={{ marginBottom: 8 }}>{error}</div>}
      {notes === null && <div className="placeholder-note">Loading notes…</div>}
      {notes !== null && notes.length === 0 && (
        <div className="placeholder-note">No field notes yet for this job.</div>
      )}
      {notes && notes.map((n) => (
        <div key={n.id} className="fnp-item">
          <div className="fnp-item-head">
            <span className="fnp-date">{shortDate(n.created_at)}</span>
          </div>
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
              {n.body && <div className="fnp-body">{n.body}</div>}
              <NoteMedia attachments={n.attachments} location={n.location} />
              <div className="fn-note-actions">
                <button className="fn-link" onClick={() => startEdit(n)}>Edit</button>
                <button className="fn-link danger" onClick={() => removeNote(n.id)}>Delete</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
