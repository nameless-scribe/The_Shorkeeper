import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import {
  getDialogueForArchive,
  parseKnowledgeArchiveIntent,
  archiveConversationToKnowledge,
} from '../conversation-knowledge';
import { insertMessage } from '../../db/repositories/messages';
import { getOrCreateDefaultSession } from '../../db/repositories/sessions';

vi.mock('../../models/complete-chat', () => ({
  completeChat: vi.fn(async () => '# 伸宏数据规范\n\n## 摘要\n修复前要评估影响范围。\n\n## 要点\n- 每次修改留痕'),
}));

vi.mock('../embedding', () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => [0.1 * (i + 1), 0.2, 0.3, 0.4]),
  ),
  embedText: vi.fn(async () => [1, 0, 0, 0]),
}));

vi.mock('../../models/config', () => ({
  loadModelConfig: vi.fn(() => ({
    apiKey: 'test',
    baseUrl: 'http://localhost',
    model: 'test',
  })),
  getModelRuntimeConfigSafe: vi.fn(() => ({
    apiKey: 'test',
    baseUrl: 'http://localhost',
    model: 'test',
    protocol: 'openai',
    profileId: 'profile-test',
  })),
}));

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `sk-kb-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SHOREKEEPER_WORKSPACE_DIR = tempDir;
  dbPath = path.join(tempDir, 'test.db');
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('parseKnowledgeArchiveIntent', () => {
  it('detects explicit archive requests', () => {
    expect(parseKnowledgeArchiveIntent('将本次对话计入知识库').triggered).toBe(true);
    expect(parseKnowledgeArchiveIntent('把刚才讨论保存到知识库').triggered).toBe(true);
    expect(parseKnowledgeArchiveIntent('写入知识库').triggered).toBe(true);
  });

  it('ignores questions about knowledge base', () => {
    expect(parseKnowledgeArchiveIntent('知识库是什么').triggered).toBe(false);
    expect(parseKnowledgeArchiveIntent('怎么用知识库').triggered).toBe(false);
  });

  it('detects turn scope', () => {
    expect(parseKnowledgeArchiveIntent('将本轮对话写入知识库').scope).toBe('turn');
    expect(parseKnowledgeArchiveIntent('将本次对话计入知识库').scope).toBe('session');
  });
});

describe('getDialogueForArchive', () => {
  it('excludes archive trigger message and returns session dialogue', () => {
    const session = getOrCreateDefaultSession();
    insertMessage(session.id, 'user', '伸宏项目修复要先评估影响范围');
    insertMessage(session.id, 'assistant', '是的，还要留痕和跑测试。');
    insertMessage(session.id, 'user', '将本次对话计入知识库');

    const rows = getDialogueForArchive(session.id, 'session');
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toContain('伸宏');
    expect(rows.some((r) => r.content.includes('计入知识库'))).toBe(false);
  });
});

describe('archiveConversationToKnowledge', () => {
  it('writes extracted markdown to knowledge base', async () => {
    const session = getOrCreateDefaultSession();
    insertMessage(session.id, 'user', '伸宏贸易关账日是每月3日');
    insertMessage(session.id, 'assistant', '收到，修复数据时要注意关账期。');
    insertMessage(session.id, 'user', '将本次对话计入知识库');

    const result = await archiveConversationToKnowledge(session.id, 'session');
    expect(result.title).toContain('伸宏');
    expect(result.document.chunkCount).toBeGreaterThan(0);
  });
});
