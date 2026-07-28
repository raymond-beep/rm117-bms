import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import AppShell from './rm117-app-shell-v1.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import './styles.css';

// Demo build (VITE_DEMO_MODE=1): no Clerk, no database, no outside services.
// The API router below answers every /api/* call from local fixtures, and
// vite.config.js has already aliased @clerk/clerk-react to a shim — so the
// ClerkProvider imported above is the stand-in, and needs no publishable key.
// See src/demo/README.md.
const DEMO = import.meta.env.VITE_DEMO_MODE === '1';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!DEMO && !PUBLISHABLE_KEY) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env');

async function boot() {
  let Root = AppShell;

  if (DEMO) {
    const [{ installDemoApi }, { default: DemoFrame }] = await Promise.all([
      import('./demo/api.js'),
      import('./demo/DemoFrame.jsx'),
    ]);
    // Install BEFORE the first render so no component can fire a real request.
    installDemoApi();
    Root = () => (
      <DemoFrame>
        <AppShell />
      </DemoFrame>
    );
  }

  // Production keeps clean paths (/bms, /financial) — it runs on Vercel with the
  // app at the domain root, so a refresh resolves server-side.
  //
  // The demo is a plain static folder served under /app/, where a refresh on
  // /app/financial has no file to hit and 404s unless the host rewrites it back to
  // index.html. Rather than depend on one host's rewrite config being right — Nick
  // and his assistant WILL refresh and share links — the demo routes in the hash,
  // which every static host serves correctly with no configuration at all.
  const Router = DEMO ? HashRouter : BrowserRouter;

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ThemeProvider>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
          <Router>
            <Root />
          </Router>
        </ClerkProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

boot();
