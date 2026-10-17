import type { CSSProperties } from 'react';
import type { AppTheme, ColorTheme } from '../core/types';

/** The colors that follow the light or dark app theme. */
interface Palette {
  bg: string;
  surface: string;
  surfaceHover: string;
  menu: string;
  text: string;
  textMuted: string;
  border: string;
  /** Toggled buttons, switches, section titles. */
  accent: string;
  accentText: string;
  /** The current tab, drawer item and links. */
  highlight: string;
}

interface ColorThemeDef {
  label: string;
  /** App and reader bars, in both app themes; white text stands on it. */
  bar: string;
  /** Bright marks on the bar and on the reader's floating panel: the position slider, the panel title. */
  barAccent: string;
  /** The accent where it stands on dark ground (bars, the reader's panel, the snackbar) in either app theme. */
  accentOnDark: string;
  /** The reader's floating Display settings card, and the cards inside it. */
  panel: string;
  panelCard: string;
  dark: Palette;
  light: Palette;
}

export const COLOR_THEMES: Record<ColorTheme, ColorThemeDef> = {
  ink: {
    label: 'Ink',
    bar: '#24292f',
    barAccent: '#8ab4f8',
    accentOnDark: '#f0a35e',
    panel: '#2b3036',
    panelCard: '#3a4048',
    dark: {
      bg: '#111315',
      surface: '#1c1f23',
      surfaceHover: '#252a2f',
      menu: '#2b3036',
      text: '#eceff2',
      textMuted: '#9aa2ab',
      border: '#2b3036',
      accent: '#f0a35e',
      accentText: '#1c1005',
      highlight: '#8ab4f8',
    },
    light: {
      bg: '#f2f3f5',
      surface: '#ffffff',
      surfaceHover: '#eceef1',
      menu: '#ffffff',
      text: '#1c2024',
      textMuted: '#5d6670',
      border: '#dadde2',
      accent: '#c0661a',
      accentText: '#ffffff',
      highlight: '#2f5fcf',
    },
  },
  paper: {
    label: 'Paper',
    bar: '#5a3e2b',
    barAccent: '#f2c98a',
    accentOnDark: '#e8b062',
    panel: '#3a2f25',
    panelCard: '#4a3d31',
    dark: {
      bg: '#1a1612',
      surface: '#26201a',
      surfaceHover: '#302820',
      menu: '#352c23',
      text: '#f2eadf',
      textMuted: '#b3a593',
      border: '#3a3128',
      accent: '#e8b062',
      accentText: '#241604',
      highlight: '#e39a6c',
    },
    light: {
      bg: '#f4eee4',
      surface: '#fffbf4',
      surfaceHover: '#f1e8da',
      menu: '#fffbf4',
      text: '#2e251b',
      textMuted: '#786a59',
      border: '#e4d9c8',
      accent: '#b06a1c',
      accentText: '#ffffff',
      highlight: '#a5532c',
    },
  },
  forest: {
    label: 'Forest',
    bar: '#1f4d36',
    barAccent: '#7fd8a6',
    accentOnDark: '#f2c14e',
    panel: '#25342b',
    panelCard: '#32443a',
    dark: {
      bg: '#0e1612',
      surface: '#18241d',
      surfaceHover: '#203027',
      menu: '#24342a',
      text: '#e8f0ea',
      textMuted: '#97aa9d',
      border: '#263a2d',
      accent: '#f2c14e',
      accentText: '#1d1500',
      highlight: '#6fcf97',
    },
    light: {
      bg: '#edf3ee',
      surface: '#ffffff',
      surfaceHover: '#e6efe8',
      menu: '#ffffff',
      text: '#1a2a20',
      textMuted: '#586b5e',
      border: '#d3e0d6',
      accent: '#a8730e',
      accentText: '#ffffff',
      highlight: '#22764a',
    },
  },
  dusk: {
    label: 'Dusk',
    bar: '#3d2c63',
    barAccent: '#c3a6ff',
    accentOnDark: '#ffb36b',
    panel: '#2e283b',
    panelCard: '#3d354d',
    dark: {
      bg: '#14111b',
      surface: '#201b2b',
      surfaceHover: '#2a2437',
      menu: '#2e283b',
      text: '#efebf5',
      textMuted: '#a69db6',
      border: '#332c42',
      accent: '#ffb36b',
      accentText: '#241200',
      highlight: '#b693ff',
    },
    light: {
      bg: '#f3f0f8',
      surface: '#ffffff',
      surfaceHover: '#eee9f5',
      menu: '#ffffff',
      text: '#241e30',
      textMuted: '#665d77',
      border: '#e0d9eb',
      accent: '#b8620a',
      accentText: '#ffffff',
      highlight: '#6a46bf',
    },
  },
  // The look the app started with, after ReadEra: a teal bar over dark navy, slate cards, amber accents.
  readera: {
    label: 'ReadEra',
    bar: '#00617c',
    barAccent: '#4fc3f7',
    accentOnDark: '#ffc107',
    panel: '#333638',
    panelCard: '#45494c',
    dark: {
      bg: '#0b1a21',
      surface: '#1c2b33',
      surfaceHover: '#253740',
      menu: '#353c41',
      text: '#eef2f4',
      textMuted: '#94a4ac',
      border: '#2b3b44',
      accent: '#ffc107',
      accentText: '#1b1400',
      highlight: '#3db3d9',
    },
    light: {
      bg: '#e8eef1',
      surface: '#ffffff',
      surfaceHover: '#f1f5f7',
      menu: '#ffffff',
      text: '#1b2a31',
      textMuted: '#5c6e77',
      border: '#d3dde2',
      accent: '#c98a00',
      accentText: '#ffffff',
      highlight: '#00799d',
    },
  },
};

/** The CSS custom properties (App.css) of a color theme in an app theme, set on the app's root element. */
export function themeStyle(color: ColorTheme, mode: AppTheme): CSSProperties {
  const theme = COLOR_THEMES[color];
  const p = theme[mode];
  return {
    '--bar': theme.bar,
    '--bar-accent': theme.barAccent,
    '--accent-on-dark': theme.accentOnDark,
    '--panel': theme.panel,
    '--panel-card': theme.panelCard,
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface-hover': p.surfaceHover,
    '--menu': p.menu,
    '--text': p.text,
    '--text-muted': p.textMuted,
    '--border': p.border,
    '--accent': p.accent,
    '--accent-text': p.accentText,
    '--highlight': p.highlight,
  } as CSSProperties;
}

/** A color theme at a glance, for its swatch in Settings: its bar and its accent. */
export const swatchBackground = (color: ColorTheme) =>
  `linear-gradient(135deg, ${COLOR_THEMES[color].bar} 50%, ${COLOR_THEMES[color].accentOnDark} 50%)`;
