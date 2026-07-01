import type { ThemePreset } from './types';

export const DEEP_SEA_THEME: ThemePreset = {
  id: 'deep-sea',
  name: '深海青',
  description: '墨蓝底与青绿光晕，偏冷静克制',
  colors: {
    navyDeep: '#081820',
    navy: '#0f3d4a',
    ice: '#e0f2f1',
    iceDeep: '#5eead4',
    cyan: '#2dd4bf',
    cyanDim: '#14b8a6',
    silver: '#a8c5c0',
    silverLight: '#e6f4f2',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(8, 24, 32, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(8, 24, 32, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(8, 24, 32, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(8, 24, 32, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(8, 24, 32, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(8, 24, 32, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(8, 24, 32, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
