import type { ThemePreset } from './types';

export const NEON_THEME: ThemePreset = {
  id: 'neon',
  name: '霓虹脉冲',
  description: '高对比暗底与电光 cyan accent',
  colors: {
    navyDeep: '#0a0a14',
    navy: '#1a1a3e',
    ice: '#e0f7ff',
    iceDeep: '#67e8f9',
    cyan: '#22d3ee',
    cyanDim: '#06b6d4',
    silver: '#a8b0c8',
    silverLight: '#e8f0ff',
  },
  backgrounds: {
    scene: 'keeper-bg.png',
    stars: true,
  },
  veil: {
    chat:
      'linear-gradient(90deg, rgba(10, 10, 20, calc(0.92 * var(--sk-veil-opacity))) 0%, rgba(10, 10, 20, calc(0.74 * var(--sk-veil-opacity))) 38%, rgba(10, 10, 20, calc(0.3 * var(--sk-veil-opacity))) 62%, rgba(10, 10, 20, calc(0.1 * var(--sk-veil-opacity))) 100%)',
    status:
      'radial-gradient(ellipse 95% 75% at 50% 28%, rgba(10, 10, 20, calc(0.25 * var(--sk-veil-opacity))) 0%, rgba(10, 10, 20, calc(0.55 * var(--sk-veil-opacity))) 50%, rgba(10, 10, 20, calc(0.9 * var(--sk-veil-opacity))) 100%)',
  },
  defaultAvatars: {
    keeper: 'keeper-avatar.png',
    user: 'user-avatar.png',
  },
  defaultVeilOpacity: 1,
};
