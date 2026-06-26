// Settings: the 5-theme picker (live, persisted) + shared defaults. Type stays
// IBM Plex across every theme — only colour changes.
import React from 'react';
import { useTheme, THEMES } from '../../lib/theme.jsx';
import Toggle from '../ui/Toggle.jsx';

export default function Settings() {
  const { theme, setTheme, clientsOnly, setClientsOnly, reducedMotion, setReducedMotion } = useTheme();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="greeting">Settings</h1>
        </div>
      </div>

      <div className="set-block">
        <div className="set-section-cap">Theme</div>
        <div className="set-theme-grid">
          {THEMES.map((t) => {
            const active = t.key === theme;
            return (
              <button
                key={t.key}
                className={`set-theme-card${active ? ' active' : ''}`}
                onClick={() => setTheme(t.key)}
                aria-pressed={active}
              >
                <div className="set-theme-preview" style={{ background: t.bg }}>
                  <div className="pv-bar" style={{ background: t.swatch, width: '42%' }} />
                  <div className="pv-row">
                    <div className="pv-dot" style={{ background: t.swatch }} />
                    <div className="pv-line" style={{ background: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
                  </div>
                  <div className="pv-row">
                    <div className="pv-line" style={{ background: t.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)' }} />
                  </div>
                </div>
                <div className="set-theme-foot">
                  <span className="set-theme-name">{t.label}</span>
                  {active
                    ? <span className="check">✓</span>
                    : <span className="set-theme-mode">{t.mode}</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="set-note">Sets colour across every screen — type stays IBM Plex throughout.</div>
      </div>

      <div className="set-block">
        <div className="set-section-cap">Defaults</div>
        <div className="set-card">
          <div className="set-toggle-row">
            <div>
              <div className="set-toggle-label">Priority Inbox — clients only</div>
              <div className="set-toggle-desc">Dim non-client mail by default on the dashboard. Synced with the toggle on the inbox card.</div>
            </div>
            <Toggle checked={clientsOnly} onChange={setClientsOnly} label="Clients only" />
          </div>
          <div className="set-toggle-row">
            <div>
              <div className="set-toggle-label">Reduced motion</div>
              <div className="set-toggle-desc">Minimise transitions on toggles, drawers, and sheets.</div>
            </div>
            <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Reduced motion" />
          </div>
        </div>
      </div>
    </div>
  );
}
