import type { ThemePreset } from './types';

export const SHOREKEEPER_THEME: ThemePreset = {
  id: 'shorekeeper',
  name: '守岸人 · 星空',
  description: '深蓝星空与 cyan 光晕',
  colors: {
    navyDeep: '#0A1128',
    navy: '#274690',
    ice: '#E1E9F0',
    iceDeep: '#89BBFE',
    cyan: '#30BCED',
    cyanDim: '#00B4D8',
    silver: '#C0C0C0',
    silverLight: '#E8EEF5',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(10, 17, 40, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(10, 17, 40, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(10, 17, 40, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(10, 17, 40, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(10, 17, 40, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(10, 17, 40, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(10, 17, 40, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
