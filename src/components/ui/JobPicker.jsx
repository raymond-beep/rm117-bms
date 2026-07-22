// Type-to-search job picker: filter by Job ID or client name, pick from matches.
// Replaces the long native <select> (the firm has 160+ jobs).
// Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
//
// Extracted from Drawing QA so Set Check picks a job the same way (2026-07-21).
// The `dqa-combo*` class names are kept on purpose — they are the styling contract
// in styles.css, and renaming them would be a cosmetic churn across both tabs.
import React, { useEffect, useMemo, useRef, useState } from 'react';

// "26_011_Kuhn_352 Amherst · Kuhn" label for a job row.
export const jobLabel = (j) => `${j.job_id}${j.client?.name ? ` · ${j.client.name}` : ''}`;

export default function JobPicker({ jobs, value, onChange, id = 'job-picker', label = 'Job' }) {
  const [query, setQuery] = useState(() => {
    const j = jobs.find((x) => x.job_id === value);
    return j ? jobLabel(j) : '';
  });
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selected = jobs.find((x) => x.job_id === value);
    // Empty query, or the query still equals the picked job's label (just focused) → browse all.
    if (!q || (selected && q === jobLabel(selected).toLowerCase())) return jobs.slice(0, 60);
    return jobs.filter((j) => jobLabel(j).toLowerCase().includes(q)).slice(0, 60);
  }, [query, jobs, value]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (j) => { onChange(j.job_id); setQuery(jobLabel(j)); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[highlight]) { e.preventDefault(); pick(matches[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="field dqa-combo" ref={boxRef} style={{ marginBottom: 0 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search by Job ID or client…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (!e.target.value.trim()) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="dqa-combo-list" role="listbox">
          {matches.length === 0 ? (
            <li className="dqa-combo-empty">No matching jobs</li>
          ) : (
            matches.map((j, i) => (
              <li
                key={j.job_id}
                role="option"
                aria-selected={j.job_id === value}
                className={`dqa-combo-opt${i === highlight ? ' is-active' : ''}${j.job_id === value ? ' is-current' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(j); }}
              >
                <span className="dqa-combo-id">{j.job_id}</span>
                {j.client?.name && <span className="dqa-combo-client">{j.client.name}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
