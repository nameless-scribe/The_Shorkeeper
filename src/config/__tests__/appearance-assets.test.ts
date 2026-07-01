import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `sk-appearance-test-${Date.now()}`);

vi.mock('../paths', () => ({
  getAppearanceDir: () => tmpDir,
}));

vi.mock('../db/app-settings', () => ({
  getJsonSetting: vi.fn(() => ({})),
  setJsonSetting: vi.fn(),
}));

import {
  resolveAppearanceAssetFilePath,
  resolveAppearanceAssetUrl,
} from '../appearance-assets';

describe('appearance-assets', () => {
  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
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
});
