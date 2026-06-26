// Shared switch toggle — used by the Priority Inbox card and Settings.
import React from 'react';

export default function Toggle({ checked, onChange, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="knob" />
    </label>
  );
}
