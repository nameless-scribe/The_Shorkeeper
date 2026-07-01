import type { ThemeColorTokens } from './types';

export function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace('#', '').trim();
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (full.length !== 6) {
    return '10 17 40';
  }
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function buildUserBubbleGradient(colors: ThemeColorTokens): string {
  return `linear-gradient(135deg, ${colors.navy} 0%, ${colors.cyan} 55%, ${colors.iceDeep} 100%)`;
}

export function buildGlassGradient(colors: ThemeColorTokens): string {
  return `linear-gradient(145deg, rgb(${hexToRgbChannels(colors.navy)} / 0.75) 0%, rgb(${hexToRgbChannels(colors.navyDeep)} / 0.85) 100%)`;
}

export function buildStarsBackground(cyanRgb: string, iceDeepRgb: string): string {
  return [
    `radial-gradient(1.5px 1.5px at 18% 22%, rgb(${cyanRgb} / 0.55) 0%, transparent 100%)`,
    `radial-gradient(1px 1px at 72% 18%, rgba(255,255,255,0.45) 0%, transparent 100%)`,
    `radial-gradient(1px 1px at 45% 65%, rgb(${iceDeepRgb} / 0.35) 0%, transparent 100%)`,
    `radial-gradient(1.5px 1.5px at 85% 78%, rgb(${cyanRgb} / 0.3) 0%, transparent 100%)`,
    `radial-gradient(1px 1px at 8% 88%, rgba(255,255,255,0.25) 0%, transparent 100%)`,
  ].join(', ');
}

/** 由 preset 色板派生的 CSS 变量（写入 :root） */
export function buildThemeCssVars(colors: ThemeColorTokens): Record<string, string> {
  const cyanRgb = hexToRgbChannels(colors.cyan);
  return {
    '--sk-user-bubble': buildUserBubbleGradient(colors),
    '--sk-glass': buildGlassGradient(colors),
    '--sk-stars-image': buildStarsBackground(cyanRgb, hexToRgbChannels(colors.iceDeep)),
    '--sk-shadow-accent': `0 0 12px rgb(${cyanRgb} / 0.65)`,
    '--sk-shadow-accent-sm': `0 0 6px rgb(${cyanRgb} / 0.35)`,
    '--sk-bg-tint-opacity': '0.25',
  };
}
