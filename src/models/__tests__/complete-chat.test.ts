import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import { completeChat } from '../complete-chat';
import { getTokenUsageSummary } from '../../db/token-usage';

vi.mock('../config', () => ({
  getModelProtocol: vi.fn(() => 'openai'),
  loadModelConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
  })),
}));

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-complete-${Date.now()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  vi.restoreAllMocks();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('completeChat usage recording', () => {
  it('records token usage from OpenAI-compatible response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '摘要内容' } }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 45,
            prompt_tokens_details: { cached_tokens: 80 },
          },
        }),
      })),
    );

    const text = await completeChat(
      [
        { role: 'system', content: '你是摘要助手' },
        { role: 'user', content: '请摘要' },
      ],
      undefined,
      { sessionId: 'session-1' },
    );

    expect(text).toBe('摘要内容');
    const summary = getTokenUsageSummary();
    expect(summary.today).toBe(165);
    expect(summary.todayCached).toBe(80);
  });

  it('skips recording when usage is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      })),
    );

    await completeChat([{ role: 'user', content: 'hi' }]);
    expect(getTokenUsageSummary().today).toBe(0);
  });
});
