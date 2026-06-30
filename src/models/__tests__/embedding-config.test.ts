import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import {
  getEmbeddingSettingsInfo,
  loadEmbeddingConfig,
  saveEmbeddingSettings,
} from '../embedding-config';
import { saveModelSettings } from '../config';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-embedding-config-${Date.now()}.db`);
  await initDatabase(dbPath);
  vi.stubEnv('OPENAI_API_KEY', 'sk-chat-key-12345678');
  vi.stubEnv('OPENAI_BASE_URL', 'https://chat.example.com/v1');
  vi.stubEnv('DEFAULT_MODEL', 'claude-opus');
  vi.stubEnv('EMBEDDING_MODEL', 'text-embedding-v3');
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('embedding config', () => {
  it('uses chat api by default', () => {
    const config = loadEmbeddingConfig();
    expect(config.apiKey).toBe('sk-chat-key-12345678');
    expect(config.baseUrl).toBe('https://chat.example.com/v1');
    expect(config.model).toBe('text-embedding-v3');
  });

  it('uses dedicated embedding api when configured', () => {
    saveEmbeddingSettings({
      useChatApi: false,
      baseUrl: 'https://embed.example.com/v1',
      model: 'text-embedding-v3',
      apiKey: 'sk-embed-key-87654321',
    });

    const config = loadEmbeddingConfig();
    expect(config.apiKey).toBe('sk-embed-key-87654321');
    expect(config.baseUrl).toBe('https://embed.example.com/v1');
    expect(config.model).toBe('text-embedding-v3');
  });

  it('prefers app chat settings over env when useChatApi is true', () => {
    saveModelSettings({
      apiKey: 'sk-app-chat-key',
      baseUrl: 'https://app-chat.example.com/v1',
      model: 'claude-opus-4-8',
    });

    const config = loadEmbeddingConfig();
    expect(config.baseUrl).toBe('https://app-chat.example.com/v1');
    expect(config.apiKey).toBe('sk-app-chat-key');
  });

  it('falls back to env embedding vars for dedicated mode', () => {
    vi.stubEnv('EMBEDDING_API_KEY', 'sk-env-embed');
    vi.stubEnv('EMBEDDING_BASE_URL', 'https://env-embed.example.com/v1/');

    saveEmbeddingSettings({ useChatApi: false });

    const config = loadEmbeddingConfig();
    expect(config.apiKey).toBe('sk-env-embed');
    expect(config.baseUrl).toBe('https://env-embed.example.com/v1');
  });

  it('reports dedicated settings info', () => {
    saveEmbeddingSettings({
      useChatApi: false,
      baseUrl: 'https://embed.example.com/v1',
      apiKey: 'sk-embed-key-87654321',
    });

    const info = getEmbeddingSettingsInfo();
    expect(info.useChatApi).toBe(false);
    expect(info.source).toBe('dedicated');
    expect(info.apiKeyConfigured).toBe(true);
  });
});
