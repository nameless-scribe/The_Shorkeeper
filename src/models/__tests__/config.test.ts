import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import { setSetting } from '../../db/app-settings';
import {
  createModelProfile,
  deleteModelProfile,
  getModelProfilesInfo,
  getModelSettingsInfo,
  loadModelConfig,
  loadModelRuntimeConfig,
  maskApiKey,
  saveModelSettings,
  setActiveModelProfile,
  updateModelProfile,
} from '../config';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-model-config-${Date.now()}.db`);
  await initDatabase(dbPath);
  vi.stubEnv('OPENAI_API_KEY', 'sk-env-key-12345678');
  vi.stubEnv('OPENAI_BASE_URL', 'https://env.example.com/v1/');
  vi.stubEnv('DEFAULT_MODEL', 'env-model');
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('model config', () => {
  it('masks api keys for display', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toMatch(/^sk-/);
    expect(maskApiKey('sk-abcdefghijklmnop')).toMatch(/nop$/);
  });

  it('falls back to env when app settings empty', () => {
    const info = getModelSettingsInfo();
    expect(info.baseUrl).toBe('https://env.example.com/v1');
    expect(info.model).toBe('env-model');
    expect(info.apiKeyConfigured).toBe(true);
    expect(info.configuredInApp).toBe(false);
  });

  it('prefers app settings over env', () => {
    saveModelSettings({
      apiKey: 'sk-app-key-87654321',
      baseUrl: 'https://app.example.com/v1',
      model: 'app-model',
    });

    const config = loadModelConfig();
    expect(config).toEqual({
      apiKey: 'sk-app-key-87654321',
      baseUrl: 'https://app.example.com/v1',
      model: 'app-model',
    });
  });

  it('keeps existing api key when patch omits it', () => {
    createModelProfile({
      name: 'test',
      baseUrl: 'https://app.example.com/v1',
      model: 'app-model',
      apiKey: 'sk-stored-key-11111111',
    });

    updateModelProfile(getModelProfilesInfo().activeId!, {
      baseUrl: 'https://app.example.com/v2',
      model: 'app-model-2',
    });

    const config = loadModelConfig();
    expect(config.apiKey).toBe('sk-stored-key-11111111');
    expect(config.baseUrl).toBe('https://app.example.com/v2');
  });

  it('supports multiple profiles and switching active', () => {
    createModelProfile({
      name: 'first',
      baseUrl: 'https://first.example.com/v1',
      model: 'model-a',
      apiKey: 'sk-first-key-11111111',
    });
    const second = createModelProfile({
      name: 'second',
      baseUrl: 'https://second.example.com/v1',
      model: 'model-b',
      apiKey: 'sk-second-key-22222222',
    });

    expect(loadModelConfig().model).toBe('model-a');

    const secondProfile = second.profiles.find((p) => p.name === 'second');
    setActiveModelProfile(secondProfile!.id);

    expect(loadModelConfig()).toEqual({
      apiKey: 'sk-second-key-22222222',
      baseUrl: 'https://second.example.com/v1',
      model: 'model-b',
    });
  });

  it('loads protocol and connection settings from one active profile snapshot', () => {
    createModelProfile({
      name: 'anthropic profile',
      baseUrl: 'https://anthropic.example.com/v1',
      model: 'claude-test',
      apiKey: 'sk-ant-key-55555555',
      protocol: 'anthropic',
    });

    expect(loadModelRuntimeConfig()).toEqual(expect.objectContaining({
      apiKey: 'sk-ant-key-55555555',
      baseUrl: 'https://anthropic.example.com/v1',
      model: 'claude-test',
      protocol: 'anthropic',
      profileId: expect.any(String),
    }));
  });

  it('migrates legacy single settings into one profile', () => {
    setSetting('model.api_key', 'sk-legacy-key-33333333');
    setSetting('model.base_url', 'https://legacy.example.com/v1');
    setSetting('model.id', 'legacy-model');

    const info = getModelProfilesInfo();
    expect(info.profiles).toHaveLength(1);
    expect(info.profiles[0]?.model).toBe('legacy-model');
    expect(loadModelConfig().apiKey).toBe('sk-legacy-key-33333333');
  });

  it('prevents deleting the last profile', () => {
    createModelProfile({
      name: 'only',
      baseUrl: 'https://only.example.com/v1',
      model: 'only-model',
      apiKey: 'sk-only-key-44444444',
    });
    const id = getModelProfilesInfo().activeId!;
    expect(() => deleteModelProfile(id)).toThrow(/至少保留/);
  });
});
