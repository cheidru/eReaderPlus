import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, type ReaderSettings, type Theme } from '../../core/types';
import './Panels.css';

interface Props {
  settings: ReaderSettings;
  fixedLayout: boolean;
  onChange: (settings: ReaderSettings) => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
];

const FONTS = [
  { value: '', label: 'Publisher default' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'system-ui, "Segoe UI", Roboto, sans-serif', label: 'Sans-serif' },
  { value: '"Atkinson Hyperlegible", Verdana, sans-serif', label: 'Legible' },
  { value: 'ui-monospace, Consolas, monospace', label: 'Monospace' },
];

const LINE_HEIGHTS = [0, 1.2, 1.4, 1.6, 1.8, 2];

export function SettingsPanel({ settings, fixedLayout, onChange, onClose }: Props) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => onChange({ ...settings, [key]: value });
  const typographyDisabled = fixedLayout || !settings.overrideStyles;

  return (
    <aside className="panel panel-right" aria-label="Display settings">
      <div className="panel-header">
        <h2>Display</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="setting">
        <span className="setting-label">Theme</span>
        <div className="segmented">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={settings.theme === t.value ? `segment segment-active theme-swatch-${t.value}` : `segment theme-swatch-${t.value}`}
              onClick={() => set('theme', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!fixedLayout && (
        <div className="setting">
          <span className="setting-label">Layout</span>
          <div className="segmented">
            <button type="button" className={settings.flow === 'paginated' ? 'segment segment-active' : 'segment'} onClick={() => set('flow', 'paginated')}>
              Pages
            </button>
            <button type="button" className={settings.flow === 'scrolled' ? 'segment segment-active' : 'segment'} onClick={() => set('flow', 'scrolled')}>
              Scroll
            </button>
          </div>
        </div>
      )}

      <label className="setting setting-row">
        <input type="checkbox" checked={!settings.overrideStyles} onChange={(e) => set('overrideStyles', !e.target.checked)} />
        <span>Publisher layout (no font or theme overrides)</span>
      </label>

      <div className="setting">
        <span className="setting-label">Font size</span>
        <div className="stepper">
          <button type="button" className="button button-ghost" disabled={typographyDisabled || settings.fontScale <= FONT_SCALE_MIN} onClick={() => set('fontScale', settings.fontScale - FONT_SCALE_STEP)}>
            A−
          </button>
          <span className="stepper-value">{settings.fontScale}%</span>
          <button type="button" className="button button-ghost" disabled={typographyDisabled || settings.fontScale >= FONT_SCALE_MAX} onClick={() => set('fontScale', settings.fontScale + FONT_SCALE_STEP)}>
            A+
          </button>
        </div>
      </div>

      <label className="setting">
        <span className="setting-label">Font</span>
        <select value={settings.fontFamily} disabled={typographyDisabled} onChange={(e) => set('fontFamily', e.target.value)}>
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="setting">
        <span className="setting-label">Line spacing</span>
        <select value={settings.lineHeight} disabled={typographyDisabled} onChange={(e) => set('lineHeight', Number(e.target.value))}>
          {LINE_HEIGHTS.map((h) => (
            <option key={h} value={h}>
              {h === 0 ? 'Publisher default' : h.toFixed(1)}
            </option>
          ))}
        </select>
      </label>

      {!fixedLayout && (
        <label className="setting">
          <span className="setting-label">Margins: {settings.margin}px</span>
          <input type="range" min={8} max={120} step={4} value={settings.margin} onChange={(e) => set('margin', Number(e.target.value))} />
        </label>
      )}
    </aside>
  );
}
