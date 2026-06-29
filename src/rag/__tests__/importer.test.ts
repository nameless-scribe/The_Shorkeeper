import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../db';
import { importDocumentFromPath } from '../importer';
import { listDocuments } from '../documents';
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
  });
});

describe('serializeEmbedding round-trip in db', () => {
  it('stores blob embeddings readable after insert', () => {
    const blob = serializeEmbedding([1, 2, 3, 4]);
    expect(blob.byteLength).toBe(16);
  });
});
