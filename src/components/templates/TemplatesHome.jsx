// Templates home — category grid for the document generators. Building-dept
// letters ship first; proposals/invoices/emails follow.
import React from 'react';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = [
  {
    key: 'letter',
    to: '/templates/letter',
    title: 'Building-Dept Letter',
    desc: 'Framing revisions, storm-water, joist specs — addressed to a municipal building department.',
    ready: true,
  },
  {
    key: 'proposal',
    to: '/templates/proposal',
    title: 'Proposal',
    desc: 'Scope of services + fee schedule for a new project. Boilerplate built in; fees per job.',
    ready: false,
  },
  {
    key: 'invoice',
    to: '/templates/invoice',
    title: 'Invoice',
    desc: 'Billing document tied to a job and its payment schedule.',
    ready: false,
  },
  {
    key: 'email',
    to: '/templates/email',
    title: 'Email',
    desc: 'Reusable client-correspondence templates.',
    ready: false,
  },
];

export default function TemplatesHome() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Drafting</div>
          <h1 className="greeting">Templates</h1>
          <div className="page-sub">Generate a document, fill the project-specific fields, print or save as PDF.</div>
        </div>
      </div>
      <div className="tpl-grid">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`tpl-card${c.ready ? '' : ' soon'}`}
            onClick={() => c.ready && navigate(c.to)}
            disabled={!c.ready}
          >
            <div className="tpl-card-title">{c.title}{!c.ready && <span className="tpl-soon">Soon</span>}</div>
            <div className="tpl-card-desc">{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
