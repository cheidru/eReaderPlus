import type { ReactNode } from 'react';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, FONT_WEIGHT_MAX, type ReaderSettings, type Theme } from '../../core/types';
import { Icon } from '../icons';
import './Panels.css';

interface Props {
  settings: ReaderSettings;
  fixedLayout: boolean;
  /** Whether the book can show two pages side by side (text, PDF and DjVu). */
  canSpread: boolean;
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

/** ReadEra's reader settings: a floating card of labeled sections. */
export function SettingsPanel({ settings, fixedLayout, canSpread, onChange, onClose }: Props) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => onChange({ ...settings, [key]: value });
  const typographyDisabled = fixedLayout || !settings.overrideStyles;
  const lineIndex = Math.max(0, LINE_HEIGHTS.indexOf(settings.lineHeight));

  return (
    <aside className="panel panel-settings" aria-label="Display settings">
      <div className="rs-header">
        <h2>Display settings</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          <Icon name="close" />
        </button>
      </div>

      {!fixedLayout && (
        <Section label="Page turning">
          <div className="segmented">
            <button type="button" className="segment" aria-pressed={settings.flow === 'paginated'} onClick={() => set('flow', 'paginated')}>
              Pages
            </button>
            <button type="button" className="segment" aria-pressed={settings.flow === 'scrolled'} onClick={() => set('flow', 'scrolled')}>
              Scroll
            </button>
          </div>
        </Section>
      )}

      <Section label="Color scheme">
        <div className="segmented">
          {THEMES.map((t) => (
            <button key={t.value} type="button" className={`segment theme-swatch-${t.value}`} aria-pressed={settings.theme === t.value} onClick={() => set('theme', t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Font">
        <select className="rs-select" value={settings.fontFamily} disabled={typographyDisabled} onChange={(e) => set('fontFamily', e.target.value)} aria-label="Font">
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Section>

      <Section label="Font size">
        <Stepper
          value={`${settings.fontScale}%`}
          decrease={{ label: 'Smaller text', disabled: typographyDisabled || settings.fontScale <= FONT_SCALE_MIN, onClick: () => set('fontScale', settings.fontScale - FONT_SCALE_STEP) }}
          increase={{ label: 'Larger text', disabled: typographyDisabled || settings.fontScale >= FONT_SCALE_MAX, onClick: () => set('fontScale', settings.fontScale + FONT_SCALE_STEP) }}
        />
      </Section>

      <Section label={`Font weight · ${settings.fontWeight === 0 ? 'normal' : `+${settings.fontWeight}`}`}>
        <input
          className="rs-range"
          type="range"
          min={0}
          max={FONT_WEIGHT_MAX}
          step={1}
          value={settings.fontWeight}
          disabled={typographyDisabled}
          onChange={(e) => set('fontWeight', Number(e.target.value))}
          aria-label="Font weight"
        />
      </Section>

      <Section label="Line spacing">
        <Stepper
          value={settings.lineHeight === 0 ? 'Publisher' : settings.lineHeight.toFixed(1)}
          decrease={{ label: 'Less line spacing', disabled: typographyDisabled || lineIndex === 0, onClick: () => set('lineHeight', LINE_HEIGHTS[lineIndex - 1]) }}
          increase={{ label: 'More line spacing', disabled: typographyDisabled || lineIndex === LINE_HEIGHTS.length - 1, onClick: () => set('lineHeight', LINE_HEIGHTS[lineIndex + 1]) }}
        />
      </Section>

      {!fixedLayout && (
        <Section label={`Page margins · ${settings.margin}px`}>
          <input className="rs-range" type="range" min={8} max={120} step={4} value={settings.margin} onChange={(e) => set('margin', Number(e.target.value))} aria-label="Page margins" />
        </Section>
      )}

      {canSpread && (
        <label className="rs-card rs-switch-row">
          <span>
            Two pages in landscape
            <small>Side by side when the window is wider than it is tall. Kept for this book</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.spread}
            disabled={!fixedLayout && settings.flow !== 'paginated'}
            onChange={(e) => set('spread', e.target.checked)}
          />
        </label>
      )}

      {canSpread && fixedLayout && (
        <label className="rs-card rs-switch-row">
          <span>
            Cover alone
            <small>The first page on its own, then pages 2–3, 4–5, … as in a printed book. Kept for this book</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.spreadCover}
            disabled={!settings.spread}
            onChange={(e) => set('spreadCover', e.target.checked)}
          />
        </label>
      )}

      <label className="rs-card rs-switch-row">
        <span>
          Publisher layout
          <small>The book's own fonts, spacing and colors</small>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={!settings.overrideStyles} onChange={(e) => set('overrideStyles', !e.target.checked)} />
      </label>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rs-card">
      <h3 className="rs-label">{label}</h3>
      {children}
    </section>
  );
}

interface StepButton {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

function Stepper({ value, decrease, increase }: { value: string; decrease: StepButton; increase: StepButton }) {
  return (
    <div className="rs-stepper">
      <button type="button" className="icon-button" aria-label={decrease.label} disabled={decrease.disabled} onClick={decrease.onClick}>
        <Icon name="removeCircle" />
      </button>
      <span className="rs-value">{value}</span>
      <button type="button" className="icon-button" aria-label={increase.label} disabled={increase.disabled} onClick={increase.onClick}>
        <Icon name="addCircle" />
      </button>
    </div>
  );
}
