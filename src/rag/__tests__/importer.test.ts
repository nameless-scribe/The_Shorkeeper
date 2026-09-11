import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../db';
import { getDocumentIncludingDeleted } from '../../db/repositories/rag-documents';
import { importDocumentFromPath, importTextAsKnowledge } from '../importer';
import { deleteDocument, listDocuments } from '../documents';
import { reindexAllDocuments, reindexDocument } from '../reindex';
import { embedText } from '../embedding';
import { serializeEmbedding } from '../vector';

vi.mock('../embedding', () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => [0.1 * (i + 1), 0.2, 0.3, 0.4]),
  ),
  embedText: vi.fn(async () => [1, 0, 0, 0]),
}));

let dbPath: string;
let db: AppDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `sk-rag-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SHOREKEEPER_WORKSPACE_DIR = tempDir;

  dbPath = path.join(tempDir, 'test.db');
  db = await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('importDocumentFromPath', () => {
  it('imports md file and writes document + chunks to db', async () => {
    const source = path.join(tempDir, 'notes.md');
    await fs.writeFile(source, '# Title\n\n守岸人的生日是 3 月 15 日。'.repeat(20), 'utf8');

    const doc = await importDocumentFromPath(source);
    expect(doc.filename).toBe('notes.md');
    expect(doc.chunkCount).toBeGreaterThan(0);

    const docs = listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(doc.id);
    expect(docs[0].summary).toBeTruthy();
    expect(docs[0]).toEqual(
      expect.objectContaining({ title: 'Title', version: 1 }),
    );
  });

  it('deduplicates the same source content by hash', async () => {
    const source = path.join(tempDir, 'same.md');
    await fs.writeFile(source, '# Same\n\n相同内容。', 'utf8');

    const first = await importDocumentFromPath(source);
    const second = await importDocumentFromPath(source);

    expect(second.id).toBe(first.id);
    expect(listDocuments()).toHaveLength(1);
  });

  it('creates a new version and atomically supersedes the prior source version', async () => {
    const source = path.join(tempDir, 'versioned.md');
    await fs.writeFile(source, '# Versioned\n\n第一版内容。', 'utf8');
    const first = await importDocumentFromPath(source);

    await fs.writeFile(source, '# Versioned\n\n第二版内容不同。', 'utf8');
    const second = await importDocumentFromPath(source);

    expect(second).toEqual(expect.objectContaining({ version: 2, status: 'indexed' }));
    expect(listDocuments().map((document) => document.id)).toEqual([second.id]);
    expect(getDocumentIncludingDeleted(first.id, db)).toEqual(
      expect.objectContaining({ status: 'superseded', supersededBy: second.id }),
    );
  });

  it('uses normalized titles as the version identity when no source path exists', async () => {
    const first = await importTextAsKnowledge('# Project Notes\n\n第一版。', 'notes-a.md');
    const second = await importTextAsKnowledge('#  project   notes  \n\n第二版。', 'notes-b.md');

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(listDocuments()).toEqual([
      expect.objectContaining({ id: second.id, titleKey: 'project notes', version: 2 }),
    ]);
  });

  it('serializes concurrent imports so document versions stay unique', async () => {
    const [first, second] = await Promise.all([
      importTextAsKnowledge('# Concurrent\n\n第一版。', 'concurrent-a.md'),
      importTextAsKnowledge('# Concurrent\n\n第二版。', 'concurrent-b.md'),
    ]);

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(listDocuments()).toEqual([
      expect.objectContaining({ id: second.id, version: 2, status: 'indexed' }),
    ]);
  });

  it('keeps the copied knowledge file and a retryable record when embedding fails', async () => {
    const source = path.join(tempDir, 'failed.md');
    await fs.writeFile(source, '# Failed\n\n这份内容不应留下孤儿文件。', 'utf8');
    vi.mocked(embedText).mockRejectedValueOnce(new Error('forced embedding failure'));

    await expect(importDocumentFromPath(source)).rejects.toThrow('forced embedding failure');

    expect(listDocuments()).toEqual([
      expect.objectContaining({
        filename: 'failed.md',
        status: 'index_failed',
        statusError: 'forced embedding failure',
        chunkCount: 0,
      }),
    ]);
    const knowledgeFiles = await fs
      .readdir(path.join(tempDir, 'knowledge'))
      .catch(() => [] as string[]);
    expect(knowledgeFiles).toHaveLength(1);

    const recovered = await reindexDocument(listDocuments()[0].id);
    expect(recovered).toEqual(
      expect.objectContaining({ status: 'indexed', statusError: null }),
    );
    expect(recovered.chunkCount).toBeGreaterThan(0);
  });

  it('keeps the prior indexed version active until a failed update is retried', async () => {
    const source = path.join(tempDir, 'safe-update.md');
    await fs.writeFile(source, '# Safe update\n\n稳定的第一版。', 'utf8');
    const first = await importDocumentFromPath(source);

    await fs.writeFile(source, '# Safe update\n\n暂时无法索引的第二版。', 'utf8');
    vi.mocked(embedText).mockRejectedValueOnce(new Error('temporary embedding failure'));
    await expect(importDocumentFromPath(source)).rejects.toThrow('temporary embedding failure');

    const beforeRetry = listDocuments();
    const failed = beforeRetry.find((document) => document.status === 'index_failed')!;
    expect(failed.version).toBe(2);
    expect(beforeRetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'indexed', version: 1 }),
        expect.objectContaining({ id: failed.id, status: 'index_failed', version: 2 }),
      ]),
    );

    await reindexDocument(failed.id);
    expect(listDocuments()).toEqual([
      expect.objectContaining({ id: failed.id, status: 'indexed', version: 2 }),
    ]);
    expect(getDocumentIncludingDeleted(first.id, db)).toEqual(
      expect.objectContaining({ status: 'superseded', supersededBy: failed.id }),
    );
  });

  it('waits for knowledge file cleanup when the database insert fails', async () => {
    const source = path.join(tempDir, 'db-failure.md');
    await fs.writeFile(source, '# Database failure\n\n这份内容不应留下孤儿文件。', 'utf8');
    db.exec(`
      CREATE TRIGGER reject_document_insert
      BEFORE INSERT ON documents
      BEGIN
        SELECT RAISE(ABORT, 'forced document failure');
      END;
    `);

    await expect(importDocumentFromPath(source)).rejects.toThrow('forced document failure');

    expect(listDocuments()).toEqual([]);
    const knowledgeFiles = await fs
      .readdir(path.join(tempDir, 'knowledge'))
      .catch(() => [] as string[]);
    expect(knowledgeFiles).toEqual([]);
  });

  it('quarantines the file before deleting its database record', async () => {
    const source = path.join(tempDir, 'delete.md');
    await fs.writeFile(source, '# Delete\n\n这份文档将被完整删除。', 'utf8');
    const document = await importDocumentFromPath(source);
    const knowledgePath = path.resolve(tempDir, document.filepath);

    await expect(deleteDocument(document.id)).resolves.toBe(true);

    expect(listDocuments()).toEqual([]);
    await expect(fs.stat(knowledgePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores a quarantined file when the database delete rolls back', async () => {
    const source = path.join(tempDir, 'delete-rollback.md');
    await fs.writeFile(source, '# Keep\n\n数据库删除失败时必须恢复文件。', 'utf8');
    const document = await importDocumentFromPath(source);
    const knowledgePath = path.resolve(tempDir, document.filepath);
    db.exec(`
      CREATE TRIGGER reject_document_delete
      BEFORE UPDATE OF status ON documents
      WHEN NEW.status = 'deleted'
      BEGIN
        SELECT RAISE(ABORT, 'forced delete failure');
      END;
    `);

    await expect(deleteDocument(document.id)).rejects.toThrow('forced delete failure');

    expect(listDocuments().map((item) => item.id)).toContain(document.id);
    await expect(fs.stat(knowledgePath)).resolves.toBeDefined();
  });

  it('rejects a trash directory symlink that escapes the workspace', async () => {
    const source = path.join(tempDir, 'delete-boundary.md');
    await fs.writeFile(source, '# Boundary\n\n删除边界测试。', 'utf8');
    const document = await importDocumentFromPath(source);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-trash-outside-'));
    await fs.symlink(outside, path.join(tempDir, 'knowledge', '.trash'), 'junction');

    await expect(deleteDocument(document.id)).rejects.toThrow('路径越界');
    await expect(fs.stat(path.resolve(tempDir, document.filepath))).resolves.toBeDefined();
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('continues a bulk rebuild when one document fails', async () => {
    const firstSource = path.join(tempDir, 'first.md');
    const secondSource = path.join(tempDir, 'second.md');
    await fs.writeFile(firstSource, '# First\n\n第一份可正常重建。', 'utf8');
    await fs.writeFile(secondSource, '# Second\n\n第二份文件将被模拟丢失。', 'utf8');
    const first = await importDocumentFromPath(firstSource);
    const second = await importDocumentFromPath(secondSource);
    await fs.unlink(path.resolve(tempDir, second.filepath));

    await expect(reindexAllDocuments()).resolves.toEqual({ indexed: 1, failed: 1 });

    expect(listDocuments()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'indexed' }),
        expect.objectContaining({ id: second.id, status: 'index_failed' }),
      ]),
    );
  });

  it('does not count an old version as failed after a newer version supersedes it', async () => {
    const source = path.join(tempDir, 'bulk-version.md');
    await fs.writeFile(source, '# Bulk version\n\n第一版。', 'utf8');
    await importDocumentFromPath(source);

    await new Promise((resolve) => setTimeout(resolve, 2));
    await fs.writeFile(source, '# Bulk version\n\n第二版。', 'utf8');
    vi.mocked(embedText).mockRejectedValueOnce(new Error('defer second version'));
    await expect(importDocumentFromPath(source)).rejects.toThrow('defer second version');

    await expect(reindexAllDocuments()).resolves.toEqual({ indexed: 1, failed: 0 });
    expect(listDocuments()).toEqual([
      expect.objectContaining({ version: 2, status: 'indexed' }),
    ]);
  });
});

describe('serializeEmbedding round-trip in db', () => {
  it('stores blob embeddings readable after insert', () => {
    const blob = serializeEmbedding([1, 2, 3, 4]);
    expect(blob.byteLength).toBe(16);
  });
});
