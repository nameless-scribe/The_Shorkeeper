import type { ThemePreset } from './types';

export const FOREST_THEME: ThemePreset = {
  id: 'forest',
  name: '晨雾绿',
  description: '深林底色与薄荷绿 accent',
  colors: {
    navyDeep: '#0a1410',
    navy: '#1a3d2e',
    ice: '#ecfdf5',
    iceDeep: '#86efac',
    cyan: '#4ade80',
    cyanDim: '#22c55e',
    silver: '#a8c4b4',
    silverLight: '#e8f5ef',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: false,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(10, 20, 16, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(10, 20, 16, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(10, 20, 16, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(10, 20, 16, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(10, 20, 16, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(10, 20, 16, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(10, 20, 16, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
