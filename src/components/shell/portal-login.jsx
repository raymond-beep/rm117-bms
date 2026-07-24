// The client portal's front door — email, then a 6-digit code.
//
// WHY THIS EXISTS. Until now the magic link WAS the login, which works beautifully right up
// until a client deletes the email. Then the only recovery is phoning the office. This is the
// self-serve path, and the thing "Client Login" on rm117.com points at.
//
// NOT a password screen, deliberately: a homeowner won't keep a password and a developer
// won't tolerate one, and every forgotten password lands on Ang's desk. A mailed code proves
// the same thing — you control the inbox — with nothing to remember.
//
// ⚠️ This must never replace the STAFF sign-in. Both live in the same Vercel deployment, so
// which door you get is decided by hostname (see shouldShowClientLogin). Staff who somehow
// land here have an explicit escape hatch at the bottom.
import React, { useState } from 'react';

// The public, client-facing hostname. Staff reach the app on its Vercel URL, where the Clerk
// screen still renders as before.
export const PORTAL_HOSTNAMES = ['portal.rm117.com'];

// Which sign-in belongs on this page load. `/login` forces the client door so the page is
// reachable in local dev, where the hostname is always localhost.
//
// `staffOverride` is the escape hatch for a staffer who ends up on the portal host. It is
// passed in rather than read here so this stays pure and testable — see readStaffOverride
// for why it has to outlive the query string.
export function shouldShowClientLogin({ hostname, pathname, search, staffOverride = false } = {}) {
  if (staffOverride) return false;
  const params = new URLSearchParams(search || '');
  if (params.get('staff') === '1') return false;
  if (pathname === '/login') return true;
  return PORTAL_HOSTNAMES.includes(hostname);
}

const STAFF_OVERRIDE_KEY = 'rm117_staff_door';

// ⚠️ The override MUST survive navigation. `?staff=1` only exists on the first URL; the
// moment the staffer signs in and clicks anything, the query string is gone and the hostname
// check would slam the client door on them again. Sticking it in sessionStorage keeps them in
// the staff app for the rest of the tab, and it clears itself when the tab closes.
export function readStaffOverride(search) {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(search || '').get('staff') === '1') {
      window.sessionStorage.setItem(STAFF_OVERRIDE_KEY, '1');
      return true;
    }
    return window.sessionStorage.getItem(STAFF_OVERRIDE_KEY) === '1';
  } catch {
    return false; // private mode / storage disabled — fall back to the query string alone
  }
}

const EMAIL_STEP = 'email';
const CODE_STEP = 'code';

// `notice` explains how you got here when it wasn't your idea — chiefly a magic link that
// expired. Without it the client just sees a login form and assumes the link was broken.
export default function PortalLogin({ notice = '' } = {}) {
  const [step, setStep] = useState(EMAIL_STEP);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function requestCode(e) {
    e?.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/portal/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (r.status === 400) {
        setError('That doesn’t look like an email address.');
      } else {
        // Any other outcome advances the step. The server answers identically for a known
        // and an unknown address on purpose, so there is nothing here to branch on — and
        // showing "no such client" would leak who the firm works with.
        setStep(CODE_STEP);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e?.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/portal/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      if (r.ok) {
        // Full reload rather than a state hand-off: the session cookie is HttpOnly, so the
        // shell's portal gate has to re-probe /api/portal/me to pick it up.
        window.location.href = '/';
        return;
      }
      const d = await r.json().catch(() => ({}));
      const left = d?.attempts_remaining;
      setError(
        typeof left === 'number' && left > 0
          ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code has expired or been used. Request a new one.',
      );
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-splash">
      <div className="portal-login">
        <div className="portal-brand">RM117<small>Architecture &amp; Design</small></div>

        {notice && step === EMAIL_STEP ? <div className="portal-login-notice">{notice}</div> : null}

        {step === EMAIL_STEP ? (
          <form className="portal-login-card" onSubmit={requestCode}>
            <h1>Client sign-in</h1>
            <p className="portal-login-sub">
              Enter the email address we use for your project and we’ll send you a sign-in code.
            </p>

            <label className="portal-login-label" htmlFor="portal-email">Email address</label>
            <input
              id="portal-email"
              className="portal-login-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="you@example.com"
            />

            {error ? <div className="portal-login-error">{error}</div> : null}

            <button className="portal-login-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
            <p className="portal-login-note">No password needed.</p>
          </form>
        ) : (
          <form className="portal-login-card" onSubmit={submitCode}>
            <h1>Check your email</h1>
            <p className="portal-login-sub">
              If <strong>{email.trim()}</strong> is on file for a project, a 6-digit code is on its
              way. It expires in 10 minutes.
            </p>

            <label className="portal-login-label" htmlFor="portal-code">Sign-in code</label>
            <input
              id="portal-code"
              className="portal-login-input portal-login-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              // Digits only — pasting "482 917" from a mail client shouldn't fail.
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
            />

            {error ? <div className="portal-login-error">{error}</div> : null}

            <button className="portal-login-btn" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              className="portal-login-link"
              type="button"
              onClick={() => { setStep(EMAIL_STEP); setCode(''); setError(''); }}
            >
              Use a different email
            </button>
          </form>
        )}

        <p className="portal-login-help">
          Trouble signing in? Reply to any email from us and we’ll help.
        </p>
        {/* Escape hatch: a staffer who lands on the portal host can still reach Clerk. */}
        <a className="portal-login-staff" href="/?staff=1">RM117 staff sign-in</a>
      </div>
    </div>
  );
}
