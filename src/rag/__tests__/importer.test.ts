import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../db';
import { importDocumentFromPath } from '../importer';
import { deleteDocument, listDocuments } from '../documents';
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
  });

  it('removes the copied knowledge file when embedding fails', async () => {
    const source = path.join(tempDir, 'failed.md');
    await fs.writeFile(source, '# Failed\n\n这份内容不应留下孤儿文件。', 'utf8');
    vi.mocked(embedText).mockRejectedValueOnce(new Error('forced embedding failure'));

    await expect(importDocumentFromPath(source)).rejects.toThrow('forced embedding failure');

    expect(listDocuments()).toEqual([]);
    const knowledgeFiles = await fs
      .readdir(path.join(tempDir, 'knowledge'))
      .catch(() => [] as string[]);
    expect(knowledgeFiles).toEqual([]);
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
      BEFORE DELETE ON documents
      BEGIN
        SELECT RAISE(ABORT, 'forced delete failure');
      END;
    `);

    await expect(deleteDocument(document.id)).rejects.toThrow('forced delete failure');

    expect(listDocuments().map((item) => item.id)).toContain(document.id);
    await expect(fs.stat(knowledgePath)).resolves.toBeDefined();
  });
});

describe('serializeEmbedding round-trip in db', () => {
  it('stores blob embeddings readable after insert', () => {
    const blob = serializeEmbedding([1, 2, 3, 4]);
    expect(blob.byteLength).toBe(16);
  });
});
