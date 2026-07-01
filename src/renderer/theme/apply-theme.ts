import type { AppearanceSettingsInfo } from '../../shared/types';

const COLOR_KEYS = [
  'navyDeep',
  'navy',
  'ice',
  'iceDeep',
  'cyan',
  'cyanDim',
  'silver',
  'silverLight',
] as const;

const CSS_VAR_MAP: Record<(typeof COLOR_KEYS)[number], string> = {
  navyDeep: '--sk-navy-deep-rgb',
  navy: '--sk-navy-rgb',
  ice: '--sk-ice-rgb',
  iceDeep: '--sk-ice-deep-rgb',
  cyan: '--sk-cyan-rgb',
  cyanDim: '--sk-cyan-dim-rgb',
  silver: '--sk-silver-rgb',
  silverLight: '--sk-silver-light-rgb',
};

function hexToRgbChannels(hex: string): string {
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

function publicAssetUrl(filename: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base}${filename}`;
}

function resolveBackgroundUrl(info: AppearanceSettingsInfo): string {
  if (info.assets.backgroundUrl) {
    return info.assets.backgroundUrl;
  }
  return publicAssetUrl(info.assets.builtinBackground);
}

function resolveAvatarUrl(customUrl: string, builtinFile: string): string {
  if (customUrl) return customUrl;
  return publicAssetUrl(builtinFile);
}

let latestAppearance: AppearanceSettingsInfo | null = null;

export function getLatestAppearance(): AppearanceSettingsInfo | null {
  return latestAppearance;
}

export function applyTheme(info: AppearanceSettingsInfo): void {
  latestAppearance = info;
  const root = document.documentElement;
  root.dataset.theme = info.presetId;

  for (const key of COLOR_KEYS) {
    root.style.setProperty(CSS_VAR_MAP[key], hexToRgbChannels(info.colors[key]));
  }

  root.style.setProperty('--sk-veil-opacity', String(info.veilOpacity));
  root.style.setProperty('--sk-veil-chat', info.veil.chat);
  root.style.setProperty('--sk-veil-status', info.veil.status);
  root.style.setProperty('--sk-bg-size', info.backgroundFit);
  root.style.setProperty('--sk-bg-image', `url("${resolveBackgroundUrl(info)}")`);
  root.style.setProperty(
    '--sk-keeper-avatar',
    `url("${resolveAvatarUrl(info.assets.keeperAvatarUrl, info.assets.builtinKeeperAvatar)}")`,
  );
  root.style.setProperty(
    '--sk-user-avatar',
    `url("${resolveAvatarUrl(info.assets.userAvatarUrl, info.assets.builtinUserAvatar)}")`,
  );
  root.style.setProperty('--sk-show-stars', info.showStars ? '1' : '0');

  document.body.style.background = `rgb(${hexToRgbChannels(info.colors.navyDeep)})`;
}

export function getResolvedKeeperAvatarSrc(info: AppearanceSettingsInfo): string {
  return resolveAvatarUrl(info.assets.keeperAvatarUrl, info.assets.builtinKeeperAvatar);
}

export function getResolvedUserAvatarSrc(info: AppearanceSettingsInfo): string {
  return resolveAvatarUrl(info.assets.userAvatarUrl, info.assets.builtinUserAvatar);
}
