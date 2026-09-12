import { describe, expect, it } from 'vitest';
import {
  parseAppearanceAssetFilename,
  parseAppearanceAssetUrl,
  toAppearanceAssetUrl,
} from '../appearance-asset-url';

describe('appearance asset URL', () => {
  it('builds sk-asset URL from filename', () => {
    expect(toAppearanceAssetUrl('bg-abc.png')).toBe('sk-asset://local/bg-abc.png');
  });

  it('encodes unsafe characters', () => {
    const url = toAppearanceAssetUrl('bg test.png');
    expect(url).toBe('sk-asset://local/bg%20test.png');
    expect(parseAppearanceAssetFilename(url)).toBe('bg test.png');
  });

  it('rejects path traversal in parse', () => {
    expect(parseAppearanceAssetFilename('sk-asset://local/..%2Fsecret.png')).toBeNull();
    expect(parseAppearanceAssetFilename('file:///etc/passwd')).toBeNull();
    expect(parseAppearanceAssetFilename('sk-asset://evil/bg.png')).toBeNull();
  });

  it('builds dist URLs for packaged builtin assets', () => {
    expect(toAppearanceAssetUrl('keeper-bg.png', 'dist')).toBe('sk-asset://dist/keeper-bg.png');
    expect(parseAppearanceAssetUrl('sk-asset://dist/keeper-bg.png')).toEqual({
      scope: 'dist',
      filename: 'keeper-bg.png',
    });
    expect(parseAppearanceAssetFilename('sk-asset://dist/keeper-bg.png')).toBeNull();
  });
});
