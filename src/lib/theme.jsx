// Theme + app-preferences engine for the "Drafting + data" redesign.
//
// Theming is driven entirely by CSS custom properties scoped to a `data-theme`
// attribute on the document root (see styles.css). This provider owns the active
// theme key plus a couple of shared UI defaults (the Priority Inbox "clients
// only" lens and a reduced-motion preference) so the Dashboard, mobile shell,
// and Settings screen all read/write one source of truth. Everything persists to
// localStorage so a reload keeps the chosen look.
import React, { createContext, useContext, useEffect, useState } from 'react';

// The 5 locked themes. `mode` drives the semantic (warn/success/bill/ff) colour
// set in styles.css. Order here is the order shown in the Settings picker.
export const THEMES = [
  { key: 'blueprint', label: 'Blueprint', mode: 'light', swatch: '#1b63e0', bg: '#eef1f3' },
  { key: 'graphite',  label: 'Graphite',  mode: 'dark',  swatch: '#4f8bf0', bg: '#15181d' },
  { key: 'sandstone', label: 'Sandstone', mode: 'light', swatch: '#b1542d', bg: '#f3eee4' },
  { key: 'forest',    label: 'Forest',    mode: 'light', swatch: '#1f7a4d', bg: '#eef2ef' },
  { key: 'indigo',    label: 'Indigo Night', mode: 'dark', swatch: '#7c6cf0', bg: '#16151d' },
];

const THEME_KEYS = THEMES.map((t) => t.key);
const DEFAULT_THEME = 'blueprint';

const STORAGE = {
  theme: 'rm117-theme',
  clientsOnly: 'rm117-clients-only',
  reducedMotion: 'rm117-reduced-motion',
};

function readString(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    if (v && (!allowed || allowed.includes(v))) return v;
  } catch { /* ignore */ }
  return fallback;
}
function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readString(STORAGE.theme, DEFAULT_THEME, THEME_KEYS));
  const [clientsOnly, setClientsOnlyState] = useState(() => readBool(STORAGE.clientsOnly, true));
  const [reducedMotion, setReducedMotionState] = useState(() => readBool(STORAGE.reducedMotion, false));

  // Bind the active theme to the document root so every surface retints live.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const meta = THEMES.find((t) => t.key === theme);
    if (meta) root.dataset.mode = meta.mode;
    try { localStorage.setItem(STORAGE.theme, theme); } catch { /* ignore */ }
  }, [theme]);

  // Reduced-motion as a root flag CSS can honour (toggle knob / drawer slides).
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'on' : 'off';
    try { localStorage.setItem(STORAGE.reducedMotion, reducedMotion ? '1' : '0'); } catch { /* ignore */ }
  }, [reducedMotion]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE.clientsOnly, clientsOnly ? '1' : '0'); } catch { /* ignore */ }
  }, [clientsOnly]);

  const setTheme = (key) => { if (THEME_KEYS.includes(key)) setThemeState(key); };

  const value = {
    theme, setTheme, themes: THEMES,
    clientsOnly, setClientsOnly: setClientsOnlyState,
    reducedMotion, setReducedMotion: setReducedMotionState,
  };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
