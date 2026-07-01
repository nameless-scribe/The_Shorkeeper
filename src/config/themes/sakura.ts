import type { ThemePreset } from './types';

export const SAKURA_THEME: ThemePreset = {
  id: 'sakura',
  name: '桜夜',
  description: '暗紫红底与樱花粉 accent',
  colors: {
    navyDeep: '#1a1018',
    navy: '#3d2438',
    ice: '#fce7f3',
    iceDeep: '#f9a8d4',
    cyan: '#fb7185',
    cyanDim: '#f472b6',
    silver: '#c4a8b8',
    silverLight: '#f5e8ef',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(26, 16, 24, calc(0.9 * var(--sk-veil-opacity))) 0%, rgba(26, 16, 24, calc(0.72 * var(--sk-veil-opacity))) 38%, rgba(26, 16, 24, calc(0.28 * var(--sk-veil-opacity))) 62%, rgba(26, 16, 24, calc(0.08 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(26, 16, 24, calc(0.22 * var(--sk-veil-opacity))) 0%, rgba(26, 16, 24, calc(0.52 * var(--sk-veil-opacity))) 50%, rgba(26, 16, 24, calc(0.88 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
