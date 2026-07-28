// A stand-in for @clerk/clerk-react, used ONLY in the demo build.
//
// vite.config.js aliases '@clerk/clerk-react' to this file when VITE_DEMO_MODE=1.
// That is what lets the demo run with no Clerk account, no Google OAuth app and no
// sign-in round trip — while leaving all ~14 component files that import Clerk
// completely untouched. Production imports the real package exactly as before;
// nothing in this file is reachable from a normal build.
//
// Everything here is a faithful-enough shape for the call sites listed in
// src/demo/api.js. If a component starts using another Clerk export, add it here
// or the demo build will fail at import time (which is the failure we want — loud,
// at build, not a blank screen for Nick).

import React from 'react';
import { DEMO_USER } from './api.js';

// The `user` object, matching the fields the app actually reads:
// fullName, firstName, primaryEmailAddress.emailAddress
const user = {
  id: DEMO_USER.id,
  fullName: DEMO_USER.name,
  firstName: DEMO_USER.name.split(' ')[0],
  primaryEmailAddress: { emailAddress: DEMO_USER.email },
  emailAddresses: [{ emailAddress: DEMO_USER.email }],
};

export function ClerkProvider({ children }) {
  return <>{children}</>;
}

// In the demo the viewer is always "signed in" — the passphrase gate upstream is
// what decides whether they get this far at all.
export function SignedIn({ children }) {
  return <>{children}</>;
}

export function SignedOut() {
  return null;
}

export function SignIn() {
  return null;
}

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user };
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: DEMO_USER.id,
    sessionId: 'demo-session',
    // The demo router ignores the token, but call sites await it — so hand back a
    // resolved value rather than undefined and let their `if (token)` branches run.
    getToken: async () => 'demo-token',
    signOut: async () => {},
  };
}

export function useClerk() {
  return {
    user,
    signOut: async () => {},
    // The Google-connect prompts in the Inbox/Calendar widgets call this. In the
    // demo both are already "connected" from fixtures, so it is never reached —
    // but if it is, say something true rather than opening nothing.
    openUserProfile: () => {
      window.alert(
        'This is where Clerk\'s account panel opens in the real app — it\'s how a staff member connects their Google account for Gmail and Calendar.',
      );
    },
  };
}

// The account button in the sidebar and mobile header. The real one opens Clerk's
// user panel; here it is a static avatar so the chrome doesn't have a hole in it.
export function UserButton() {
  const initials = DEMO_USER.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  return (
    <div
      title={`${DEMO_USER.name} — ${DEMO_USER.email}`}
      style={{
        width: 30, height: 30, borderRadius: '50%',
        background: 'var(--accent, #b08d57)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 600, letterSpacing: '.02em', userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
}
