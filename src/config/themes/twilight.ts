import type { ThemePreset } from './types';

export const TWILIGHT_THEME: ThemePreset = {
  id: 'twilight',
  name: '薄暮紫',
  description: '暮光紫调与淡紫 accent',
  colors: {
    navyDeep: '#151025',
    navy: '#2e2448',
    ice: '#ede9fe',
    iceDeep: '#a78bfa',
    cyan: '#c4b5fd',
    cyanDim: '#8b5cf6',
    silver: '#b8b0c8',
    silverLight: '#ede8f5',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(21, 16, 37, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(21, 16, 37, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(21, 16, 37, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(21, 16, 37, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(21, 16, 37, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(21, 16, 37, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(21, 16, 37, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
