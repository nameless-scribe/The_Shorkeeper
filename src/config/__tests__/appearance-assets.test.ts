import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `sk-appearance-test-${Date.now()}`);
const mocks = vi.hoisted(() => ({
  assets: {} as Record<string, string | null>,
  failSave: false,
}));

vi.mock('../paths', () => ({
  getAppearanceDir: () => tmpDir,
}));

vi.mock('../../db/app-settings', () => ({
  getJsonSetting: vi.fn(() => ({ ...mocks.assets })),
  setJsonSetting: vi.fn((_key: string, value: Record<string, string | null>) => {
    if (mocks.failSave) throw new Error('settings write failed');
    mocks.assets = { ...value };
  }),
}));

import {
  importAvatarAsset,
  importBackgroundAsset,
  resolveAppearanceAssetFilePath,
  resolveAppearanceAssetUrl,
} from '../appearance-assets';

describe('appearance-assets', () => {
  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
    mocks.assets = {};
    mocks.failSave = false;
  });

  it('returns sk-asset URL for renderer', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'bg-test.png'), 'x');

    expect(resolveAppearanceAssetUrl('bg-test.png')).toBe('sk-asset://local/bg-test.png');
    expect(resolveAppearanceAssetFilePath('bg-test.png')).toBe(path.join(tmpDir, 'bg-test.png'));
  });

  it('returns null when file missing', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(resolveAppearanceAssetUrl('missing.png')).toBeNull();
  });

  it('keeps the previous background when a replacement is invalid', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const previous = path.join(tmpDir, 'bg-old.png');
    fs.writeFileSync(previous, 'old');
    mocks.assets = { background: 'bg-old.png' };

    expect(() => importBackgroundAsset(path.join(tmpDir, 'missing.png'))).toThrow('文件不存在');
    expect(fs.readFileSync(previous, 'utf8')).toBe('old');
    expect(mocks.assets.background).toBe('bg-old.png');
  });

  it('removes the new copy and keeps the previous avatar when settings persistence fails', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const previous = path.join(tmpDir, 'avatar-keeper-old.png');
    const source = path.join(tmpDir, 'replacement.png');
    fs.writeFileSync(previous, 'old');
    fs.writeFileSync(source, 'new');
    mocks.assets = { keeperAvatar: 'avatar-keeper-old.png' };
    mocks.failSave = true;

    expect(() => importAvatarAsset(source, 'keeperAvatar')).toThrow('settings write failed');
    expect(fs.readFileSync(previous, 'utf8')).toBe('old');
    expect(
      fs.readdirSync(tmpDir).filter((name) => name.startsWith('avatar-keeper-')),
    ).toEqual(['avatar-keeper-old.png']);
  });
});
