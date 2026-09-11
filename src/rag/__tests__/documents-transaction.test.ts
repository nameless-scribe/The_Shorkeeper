import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../../db';
import { insertDocumentWithChunks, replaceDocumentChunks } from '../documents';
import { serializeEmbedding } from '../vector';

describe('RAG document transactions', () => {
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `rag-transaction-${Date.now()}-${Math.random()}.db`);
    await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('restores the original chunks when replacement fails midway', () => {
    const embedding = serializeEmbedding([1, 0, 0]);
    const document = insertDocumentWithChunks({
      filename: 'test.md',
      filepath: 'test.md',
      mimeType: 'text/markdown',
      chunks: [{ content: 'original', embedding, ftsText: 'original' }],
    });
    const db = getDatabase();
    db.exec(`
      CREATE TRIGGER fail_second_chunk
      BEFORE INSERT ON document_chunks
      WHEN NEW.chunk_index = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced chunk failure');
      END;
    `);

    expect(() =>
      replaceDocumentChunks(document.id, [
        { content: 'replacement one', embedding, ftsText: 'replacement one' },
        { content: 'replacement two', embedding, ftsText: 'replacement two' },
      ]),
    ).toThrow('forced chunk failure');

    const rows = db
      .prepare(
        'SELECT chunk_index, content FROM document_chunks WHERE document_id = ? ORDER BY chunk_index',
      )
      .all(document.id);
    expect(rows).toEqual([{ chunk_index: 0, content: 'original' }]);
    const row = db.prepare('SELECT chunk_count FROM documents WHERE id = ?').get(document.id);
    expect(row?.chunk_count).toBe(1);
  });
});
