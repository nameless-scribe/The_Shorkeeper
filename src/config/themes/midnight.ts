import type { ThemePreset } from './types';

export const MIDNIGHT_THEME: ThemePreset = {
  id: 'midnight',
  name: '午夜紫',
  description: '深紫背景与粉紫强调',
  colors: {
    navyDeep: '#1a1028',
    navy: '#2d1b4e',
    ice: '#E8E0F0',
    iceDeep: '#c084fc',
    cyan: '#e879a8',
    cyanDim: '#c084fc',
    silver: '#B8A8C8',
    silverLight: '#E8E0F0',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(26, 16, 40, calc(0.92 * var(--sk-veil-opacity))) 0%, rgba(26, 16, 40, calc(0.75 * var(--sk-veil-opacity))) 38%, rgba(26, 16, 40, calc(0.3 * var(--sk-veil-opacity))) 62%, rgba(26, 16, 40, calc(0.1 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(26, 16, 40, calc(0.25 * var(--sk-veil-opacity))) 0%, rgba(26, 16, 40, calc(0.55 * var(--sk-veil-opacity))) 50%, rgba(26, 16, 40, calc(0.9 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
