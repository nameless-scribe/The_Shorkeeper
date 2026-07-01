import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceSettingsInfo } from '@/shared/types';

const base: AppearanceSettingsInfo = {
  presetId: 'midnight',
  presetName: '午夜紫',
  presets: [],
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
  assets: {
    backgroundUrl: 'sk-asset://local/bg-test.png',
    keeperAvatarUrl: '',
    userAvatarUrl: '',
    builtinBackground: 'keeper-bg.png',
    builtinKeeperAvatar: 'keeper-avatar.png',
    builtinUserAvatar: 'user-avatar.png',
  },
  veil: { chat: 'none', status: 'none' },
  hasCustomAssets: true,
  backgroundFit: 'cover',
  veilOpacity: 0.85,
  showStars: true,
};

function installMockDocument() {
  const styleMap = new Map<string, string>();
  const docEl = {
    style: {
      setProperty: (key: string, value: string) => {
        styleMap.set(key, value);
      },
      getPropertyValue: (key: string) => styleMap.get(key) ?? '',
      removeProperty: (key: string) => {
        styleMap.delete(key);
      },
    },
    dataset: {} as DOMStringMap,
    removeAttribute: vi.fn(function (this: { dataset: DOMStringMap }, name: string) {
      if (name === 'style') {
        styleMap.clear();
      }
      if (name === 'data-theme') {
        delete this.dataset.theme;
      }
    }),
  };
  const body = { style: { background: '' } };
  vi.stubGlobal('document', {
    documentElement: docEl,
    body,
  });
  return { styleMap, docEl };
}

describe('applyTheme', () => {
  let mock: ReturnType<typeof installMockDocument>;

  beforeEach(async () => {
    mock = installMockDocument();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets user bubble gradient from preset colors', async () => {
    const { applyTheme } = await import('../apply-theme');
    applyTheme(base);
    expect(mock.styleMap.get('--sk-user-bubble')).toContain('#e879a8');
  });

  it('keeps custom background url in --sk-bg-image', async () => {
    const { applyTheme } = await import('../apply-theme');
    applyTheme(base);
    expect(mock.styleMap.get('--sk-bg-image')).toContain('bg-test.png');
  });

  it('sets data-theme on document element', async () => {
    const { applyTheme } = await import('../apply-theme');
    applyTheme(base);
    expect(mock.docEl.dataset.theme).toBe('midnight');
  });
});
