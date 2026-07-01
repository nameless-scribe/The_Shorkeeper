import type { ThemePreset } from './types';

export const SLATE_THEME: ThemePreset = {
  id: 'slate',
  name: '板岩灰',
  description: '低饱和灰蓝底与天蓝 accent',
  colors: {
    navyDeep: '#121820',
    navy: '#2a3444',
    ice: '#f1f5f9',
    iceDeep: '#94a3b8',
    cyan: '#38bdf8',
    cyanDim: '#0ea5e9',
    silver: '#94a3b8',
    silverLight: '#e2e8f0',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: false,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(18, 24, 32, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(18, 24, 32, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(18, 24, 32, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(18, 24, 32, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(18, 24, 32, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(18, 24, 32, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(18, 24, 32, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
