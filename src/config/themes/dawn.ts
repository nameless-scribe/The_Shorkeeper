import type { ThemePreset } from './types';

export const DAWN_THEME: ThemePreset = {
  id: 'dawn',
  name: '拂晓',
  description: '略浅背景与暖色 accent',
  colors: {
    navyDeep: '#1a2332',
    navy: '#3d4f6f',
    ice: '#F0F4F8',
    iceDeep: '#9cb4d8',
    cyan: '#f4a261',
    cyanDim: '#e76f51',
    silver: '#C8D0DC',
    silverLight: '#EEF2F7',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: false,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(26, 35, 50, calc(0.88 * var(--sk-veil-opacity))) 0%, rgba(26, 35, 50, calc(0.68 * var(--sk-veil-opacity))) 38%, rgba(26, 35, 50, calc(0.26 * var(--sk-veil-opacity))) 62%, rgba(26, 35, 50, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(26, 35, 50, calc(0.2 * var(--sk-veil-opacity))) 0%, rgba(26, 35, 50, calc(0.48 * var(--sk-veil-opacity))) 50%, rgba(26, 35, 50, calc(0.85 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
