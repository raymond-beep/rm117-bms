// Set Check — verify what contractors buy, submit, and count against RM117's
// drawing set. Sibling of Drawing QA (src/components/drawing-qa/); same shape:
// pick a job → pick Drive documents → AI check → a person confirms.
//
// THIS IS THE PLACEHOLDER SCAFFOLD (Phase 0). The tab is registered and routes
// here, but the check engine isn't built yet. Canonical plan + build phases live
// in SET_CHECK.md at the repo root. Replace this page starting at Phase 1.
import React from 'react';

const PHASES = [
  { n: '0', label: 'Scaffold — tab, placeholder page, draft migration, plan doc', done: true },
  { n: '1', label: 'DB + read — apply migration 0017, job picker + Drive document picker', done: false },
  { n: '2', label: 'Extract — AI reads window schedule (size), REScheck (U-factor), vendor brochure', done: false },
  { n: '3', label: 'Compare + confirm — match units to tags, pass/flag per size & U-factor, human confirms', done: false },
  { n: '4', label: 'Extend — exterior doors, fire-rated doors, scheduled fixtures', done: false },
  { n: '5', label: 'Takeoffs (later) — counts, then area/linear quantities', done: false },
];

export default function SetCheck() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Drawing set · compliance &amp; takeoff</div>
          <h1 className="greeting">Set Check</h1>
        </div>
      </div>
      <div className="card">
        <p className="sc-intro">
          Reads our drawing set and checks what contractors buy, submit, and count
          against what we specified. Windows first — verify a purchased unit’s size
          against the schedule and its U-factor against the REScheck. Build in
          progress; see <code>SET_CHECK.md</code>.
        </p>
        <ol className="sc-phases">
          {PHASES.map((p) => (
            <li key={p.n} className={p.done ? 'sc-phase done' : 'sc-phase'}>
              <span className="sc-phase-n">{p.done ? '✓' : p.n}</span>
              <span>{p.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
