import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { checkVisionConfig, getVisionSettingsInfo, resolveVisionSettings, saveVisionSettings } from '../vision';

let root: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['VISION_ENABLED', 'VISION_MODEL', 'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MAX_PIXELS', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'DEFAULT_MODEL'];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-vision-settings-'));
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  await initDatabase(path.join(root, 'settings.db'));
});

afterAll(async () => {
  closeDatabase();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

afterEach(() => {
  saveVisionSettings({ enabled: false, clearCredentials: true, model: 'qwen3-vl-plus' });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

describe('vision settings', () => {
  it('is disabled by default and says so without touching credentials', () => {
    const info = getVisionSettingsInfo();
    expect(info.enabled).toBe(false);
    expect(info.model).toBe('qwen3-vl-plus');
    expect(info.configured).toBe(false);
    expect(info.reason).toContain('未开启');
    expect(checkVisionConfig()).toMatchObject({ ok: false, disabled: true });
  });

  it('reuses the shared OpenAI-compatible endpoint once enabled, and reports when none exists', () => {
    saveVisionSettings({ enabled: true });
    const missing = checkVisionConfig();
    expect(missing).toMatchObject({ ok: false, disabled: false });
    process.env.OPENAI_API_KEY = 'sk-shared';
    process.env.OPENAI_BASE_URL = 'https://shared.test/v1';
    const shared = checkVisionConfig();
    expect(shared).toMatchObject({ ok: true, credentialsSource: 'shared', endpoint: { apiKey: 'sk-shared', model: 'qwen3-vl-plus' } });
    expect(getVisionSettingsInfo()).toMatchObject({ configured: true, credentialsSource: 'shared', apiKeyMasked: '' });
  });

  it('prefers its own endpoint and key, masks the key and can clear it', () => {
    saveVisionSettings({ enabled: true, baseUrl: 'https://own.test/v1/', apiKey: 'sk-own-1234567890', model: 'qwen3-vl-flash', maxPixels: 4_000_000 });
    const settings = resolveVisionSettings();
    expect(settings).toMatchObject({ ownBaseUrl: 'https://own.test/v1', ownApiKey: 'sk-own-1234567890', model: 'qwen3-vl-flash', maxPixels: 4_000_000 });
    expect(checkVisionConfig()).toMatchObject({ ok: true, credentialsSource: 'own', endpoint: { baseUrl: 'https://own.test/v1', model: 'qwen3-vl-flash' } });
    const info = getVisionSettingsInfo();
    expect(info.apiKeyMasked).not.toContain('1234567890');
    expect(info.apiKeyMasked.startsWith('sk-o')).toBe(true);
    saveVisionSettings({ clearCredentials: true });
    expect(resolveVisionSettings().ownApiKey).toBe('');
  });

  it('rejects half-filled credentials and bad values', () => {
    saveVisionSettings({ enabled: true, baseUrl: 'https://own.test/v1' });
    expect(checkVisionConfig()).toMatchObject({ ok: false, reason: expect.stringContaining('同时填') });
    expect(() => saveVisionSettings({ model: 'bad model!' })).toThrow('模型 ID');
    expect(() => saveVisionSettings({ baseUrl: 'ftp://x' })).toThrow('http');
    expect(() => saveVisionSettings({ maxPixels: 10 })).toThrow('像素');
  });
});
