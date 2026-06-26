// Generic "coming soon" placeholder page (e.g. the Templates route).
import React from 'react';

export default function ComingSoon({ title, phase, detail }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{phase}</div>
          <h1 className="greeting">{title}</h1>
        </div>
      </div>
      <div className="card"><div className="card-body placeholder-note">{detail}</div></div>
    </div>
  );
}
