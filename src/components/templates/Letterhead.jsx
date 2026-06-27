// RM117 document letterhead — the fixed header on building-dept letters and
// proposals. Centered firm mark + the standard address/contact line, matching
// the firm's letter style.
import React from 'react';

export default function Letterhead() {
  return (
    <div className="doc-letterhead">
      <svg className="doc-logo" width="34" height="26" viewBox="0 0 34 26" fill="none"
           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12 L17 3 L31 12" />
        <path d="M3 22 L17 13 L31 22" />
      </svg>
      <div className="doc-firm">Room 117 Architecture + Design, LLC</div>
      <div className="doc-firm-addr">
        836 Galloping Hill Road | Roselle Park | NJ 07204 | T: 908.451.4633 | Email: tom@rm117.com
      </div>
    </div>
  );
}
