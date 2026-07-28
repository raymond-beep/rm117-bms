// Demo chrome: the passphrase screen, and the floating badge that keeps "this is
// fictional data" on screen without disturbing the app's layout.
//
// ⚠️ ON THE PASSPHRASE — be honest about what it is. The demo is a static bundle,
// so this check runs in the browser and a determined person can read past it in
// devtools. It is a "not for casual visitors" sign, not a security control, and it
// is proportionate here precisely BECAUSE there is nothing behind it worth taking:
// no credentials ship with this build and every record in it is invented. If the
// demo ever carries something real, replace this with Vercel's project-level
// Password Protection (a server-side gate) instead of hardening this file.

import React, { useState } from 'react';
import { resetDemo, hasEdits } from './store.js';

// Shared with the demo site's landing page (same origin, same key) so the access
// code is typed once and covers both apps.
const UNLOCK_KEY = 'demo-unlocked';
const PASSPHRASE = import.meta.env.VITE_DEMO_PASSWORD || '';

function isUnlocked() {
  if (!PASSPHRASE) return true; // no passphrase configured → open demo
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export default function DemoFrame({ children }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);

  if (!unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;

  return (
    <>
      {children}
      <DemoBadge />
    </>
  );
}

function Lock({ onUnlock }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (value.trim().toLowerCase() === PASSPHRASE.trim().toLowerCase()) {
      try {
        sessionStorage.setItem(UNLOCK_KEY, '1');
      } catch {
        /* private mode — they'll just re-enter it on the next tab */
      }
      onUnlock();
    } else {
      setError(true);
    }
  }

  return (
    <div style={S.lockWrap}>
      <form onSubmit={submit} style={S.lockCard}>
        <div style={S.brand}>
          RM117<span style={S.brandSub}>Architecture &amp; Design</span>
        </div>
        <div style={S.lockTitle}>Business Management System</div>
        <p style={S.lockCopy}>
          This is a demonstration copy. Everything in it is sample data — no real client,
          project or financial information is present.
        </p>
        <label style={S.label} htmlFor="demo-pass">Access code</label>
        <input
          id="demo-pass"
          type="password"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          style={{ ...S.input, borderColor: error ? '#c0504d' : 'rgba(255,255,255,.18)' }}
          placeholder="Enter the code you were sent"
        />
        {error && <div style={S.error}>That code doesn&rsquo;t match. Check the message you were sent.</div>}
        <button type="submit" style={S.button}>Open the demo</button>
      </form>
    </div>
  );
}

function DemoBadge() {
  const [open, setOpen] = useState(false);

  function reset() {
    if (!window.confirm('Reset the demo back to its starting data? Anything you changed here will be discarded.')) return;
    resetDemo();
    window.location.reload();
  }

  return (
    <div style={S.badgeWrap}>
      {open && (
        <div style={S.panel}>
          <div style={S.panelTitle}>You&rsquo;re in the demo</div>
          <p style={S.panelCopy}>
            Every job, client, invoice and dollar figure here is invented. This build ships
            with no database and no service credentials, so it cannot reach Room 117&rsquo;s
            real data.
          </p>
          <p style={S.panelCopy}>
            Changes you make — moving a job, logging a payment, writing in the planner — are
            saved in <em>this browser only</em>. Nobody else sees them.
          </p>
          <p style={S.panelCopy}>
            The tabs that normally read from QuickBooks, Gmail, Google Drive and the AI
            drawing review are showing sample responses. See{' '}
            <a href="/setup" style={S.link}>Setup &amp; Connections</a>{' '}
            for what each one needs to go live.
          </p>
          <p style={S.panelCopy}>
            <a href="/" style={S.link}>← Back to both demos</a>
          </p>
          <button style={S.resetBtn} onClick={reset}>
            Reset demo data{hasEdits() ? ' (you have edits)' : ''}
          </button>
        </div>
      )}
      <button style={S.pill} onClick={() => setOpen((v) => !v)} title="About this demo">
        <span style={S.dot} /> Demo — sample data
      </button>
    </div>
  );
}

const S = {
  lockWrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f0f0f', color: '#f2efe9', padding: 20,
  },
  lockCard: {
    width: '100%', maxWidth: 420, background: '#191919',
    border: '1px solid rgba(255,255,255,.10)', borderRadius: 14, padding: '32px 30px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  brand: { fontSize: 22, fontWeight: 700, letterSpacing: '.06em', marginBottom: 2 },
  brandSub: { display: 'block', fontSize: 10, fontWeight: 400, letterSpacing: '.18em', textTransform: 'uppercase', opacity: .55, marginTop: 4 },
  lockTitle: { marginTop: 20, fontSize: 15, fontWeight: 600 },
  lockCopy: { marginTop: 8, fontSize: 13, lineHeight: 1.55, opacity: .68 },
  label: { display: 'block', marginTop: 22, marginBottom: 6, fontSize: 11, letterSpacing: '.10em', textTransform: 'uppercase', opacity: .55 },
  input: {
    width: '100%', padding: '11px 13px', borderRadius: 8, fontSize: 14,
    background: '#0f0f0f', border: '1px solid rgba(255,255,255,.18)', color: '#f2efe9',
    outline: 'none', boxSizing: 'border-box',
  },
  error: { marginTop: 8, fontSize: 12.5, color: '#e08b88' },
  button: {
    width: '100%', marginTop: 18, padding: '11px 14px', borderRadius: 8, border: 0,
    background: '#b08d57', color: '#141414', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  badgeWrap: { position: 'fixed', right: 16, bottom: 16, zIndex: 9999, fontFamily: 'system-ui, -apple-system, sans-serif' },
  pill: {
    display: 'flex', alignItems: 'center', gap: 7, marginLeft: 'auto',
    padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
    background: 'rgba(20,20,20,.92)', color: '#f2efe9',
    border: '1px solid rgba(176,141,87,.55)', fontSize: 12, fontWeight: 500,
    backdropFilter: 'blur(6px)', boxShadow: '0 4px 14px rgba(0,0,0,.35)',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#b08d57', display: 'inline-block' },
  panel: {
    width: 320, marginBottom: 10, padding: '16px 17px', borderRadius: 12,
    background: 'rgba(20,20,20,.97)', color: '#f2efe9',
    border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 10px 34px rgba(0,0,0,.5)',
    backdropFilter: 'blur(8px)',
  },
  panelTitle: { fontSize: 13, fontWeight: 600, marginBottom: 8 },
  panelCopy: { fontSize: 12.5, lineHeight: 1.55, opacity: .74, margin: '0 0 9px' },
  link: { color: '#c9a26b', textDecoration: 'underline' },
  resetBtn: {
    width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 7, cursor: 'pointer',
    background: 'transparent', color: '#f2efe9',
    border: '1px solid rgba(255,255,255,.22)', fontSize: 12.5,
  },
};
