import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { createMemory } from '../../db/repositories/long-term-memory';
import { createMemorySource } from '../../db/repositories/memory-sources';
import { insertDocumentWithChunks, updateDocumentMeta } from '../../db/repositories/rag-documents';
import { resolveContextSourceRef } from '../context-sources';

describe('context source resolver', () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-source-detail-'));
    await initDatabase(path.join(dir, 'source-detail.db'));
  });
  afterEach(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hides private memory content while retaining its origin', () => {
    const memory = createMemory({
      memoryKey: 'user.private.note', content: '不应直接显示', importance: 0.8,
      confidence: 0.9, sensitivity: 'private', memoryType: 'identity', createdAt: 100,
    });
    createMemorySource({ memoryId: memory.id, sourceType: 'conversation', sourceSessionId: 'session-1' });
    expect(resolveContextSourceRef(`mem:${memory.id}`)).toMatchObject({
      available: true, content: '私密记忆内容已隐藏。', meta: expect.stringContaining('会话 session-1'),
    });
  });

  it('keeps a historical document citation resolvable after the document is superseded', () => {
    const document = insertDocumentWithChunks({
      filename: 'history.md', filepath: 'knowledge/history.md', mimeType: 'text/markdown', version: 1,
      chunks: [{ content: '旧版本仍是历史运行的证据', ftsText: '旧版本仍是历史运行的证据', embedding: new Uint8Array([0, 0, 128, 63]) }],
    });
    updateDocumentMeta(document.id, { status: 'superseded' });
    expect(resolveContextSourceRef(`doc:${document.id}#chunk:0`)).toMatchObject({
      available: true, content: '旧版本仍是历史运行的证据', meta: expect.stringContaining('文档 v1'),
    });
  });

  it('rejects refs that could escape the stable source namespace', () => {
    expect(() => resolveContextSourceRef('doc:../../secret#chunk:0')).toThrow('格式无效');
  });
});
