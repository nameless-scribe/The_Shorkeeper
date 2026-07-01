import { describe, expect, it } from 'vitest';
import {
  parseAppearanceAssetFilename,
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
});
