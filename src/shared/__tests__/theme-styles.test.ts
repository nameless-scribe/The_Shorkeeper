import { describe, expect, it } from 'vitest';
import { buildThemeCssVars, buildUserBubbleGradient } from '../theme-styles';

describe('theme-styles', () => {
  it('buildUserBubbleGradient uses preset accent colors', () => {
    const gradient = buildUserBubbleGradient({
      navyDeep: '#1a1028',
      navy: '#2d1b4e',
      ice: '#E8E0F0',
      iceDeep: '#c084fc',
      cyan: '#e879a8',
      cyanDim: '#c084fc',
      silver: '#B8A8C8',
      silverLight: '#E8E0F0',
    });
    expect(gradient).toContain('#e879a8');
    expect(gradient).toContain('#2d1b4e');
  });

  it('buildThemeCssVars includes derived tokens', () => {
    const vars = buildThemeCssVars({
      navyDeep: '#1a1028',
      navy: '#2d1b4e',
      ice: '#E8E0F0',
      iceDeep: '#c084fc',
      cyan: '#e879a8',
      cyanDim: '#c084fc',
      silver: '#B8A8C8',
      silverLight: '#E8E0F0',
    });
    expect(vars['--sk-user-bubble']).toContain('#e879a8');
    expect(vars['--sk-shadow-accent']).toContain('232 121 168');
  });
});
