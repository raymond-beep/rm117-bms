// Mobile "Appearance" bottom sheet — the only way to switch themes on a phone
// (the sidebar/Settings nav is hidden there). Reuses the Settings theme cards.
import React from 'react';
import { useTheme, THEMES } from '../../lib/theme.jsx';

export default function MobileThemeSheet({ onClose }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Appearance">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title">Appearance</h2>
            <div className="sheet-sub">Type stays IBM Plex</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="set-theme-grid">
          {THEMES.map((t) => {
            const active = t.key === theme;
            return (
              <button key={t.key} className={`set-theme-card${active ? ' active' : ''}`} onClick={() => { setTheme(t.key); onClose(); }}>
                <div className="set-theme-preview" style={{ background: t.bg }}>
                  <div className="pv-bar" style={{ background: t.swatch, width: '42%' }} />
                  <div className="pv-row">
                    <div className="pv-dot" style={{ background: t.swatch }} />
                    <div className="pv-line" style={{ background: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
                  </div>
                </div>
                <div className="set-theme-foot">
                  <span className="set-theme-name">{t.label}</span>
                  {active ? <span className="check">✓</span> : <span className="set-theme-mode">{t.mode}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
