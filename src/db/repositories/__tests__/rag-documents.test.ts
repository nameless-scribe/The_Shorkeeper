import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase, type AppDatabase } from '../../index';
import {
  deleteDocumentData,
  findDocumentByContentHash,
  getAdjacentChunks,
  getDocument,
  getStoredEmbeddingDimensions,
  hasDocumentChunksFts,
  insertDocumentWithChunks,
  listDocuments,
  loadAllChunkEmbeddingRecords,
  loadAllDocumentEmbeddings,
  loadFtsSourceRows,
  rebuildFtsIndex,
  replaceDocumentChunks,
  searchDocumentChunkFtsRanks,
  updateDocumentMeta,
} from '../rag-documents';

describe('RAG documents repository', () => {
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `rag-repository-${Date.now()}-${Math.random()}.db`);
    db = await initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(dbPath, { force: true });
  });

  it('keeps document metadata, chunks, and embeddings consistent', () => {
    const document = insertDocumentWithChunks(
      {
        filename: 'notes.md',
        filepath: 'knowledge/notes.md',
        mimeType: 'text/markdown',
        contentHash: 'hash-1',
        embeddingModel: 'embedding-test',
        embeddingDim: 2,
        summary: '初始摘要',
        outline: '# 标题',
        docEmbedding: new Uint8Array([1, 2, 3, 4]),
        chunks: [
          { content: '第一段', embedding: new Uint8Array([1, 0, 0, 0]), ftsText: '第一段' },
          { content: '第二段', embedding: new Uint8Array([2, 0, 0, 0]), ftsText: '第二段' },
        ],
      },
      db,
    );

    expect(getDocument(document.id, db)).toEqual(document);
    expect(findDocumentByContentHash('hash-1', db)).toEqual(document);
    expect(listDocuments(db)).toEqual([document]);
    expect(getStoredEmbeddingDimensions(db)).toEqual([2]);
    expect(getAdjacentChunks(document.id, 0, 1, db)).toEqual([
      { chunkIndex: 0, content: '第一段' },
      { chunkIndex: 1, content: '第二段' },
    ]);
    expect(loadAllDocumentEmbeddings(db)[0].embedding).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(loadAllChunkEmbeddingRecords(db).map((row) => row.embedding)).toEqual([
      new Uint8Array([1, 0, 0, 0]),
      new Uint8Array([2, 0, 0, 0]),
    ]);
    expect(loadFtsSourceRows(db)).toEqual([
      expect.objectContaining({ documentId: document.id, content: '第一段' }),
      expect.objectContaining({ documentId: document.id, content: '第二段' }),
    ]);

    updateDocumentMeta(
      document.id,
      { summary: '更新摘要', embeddingDim: 4, docEmbedding: new Uint8Array([9, 8]) },
      db,
    );
    expect(getDocument(document.id, db)).toEqual(
      expect.objectContaining({ summary: '更新摘要', embeddingDim: 4 }),
    );

    replaceDocumentChunks(
      document.id,
      [{ content: '替换段落', embedding: new Uint8Array([3, 0, 0, 0]), ftsText: '替换段落' }],
      { embeddingModel: 'embedding-next', embeddingDim: 1 },
      db,
    );
    expect(loadAllChunkEmbeddingRecords(db)).toEqual([
      expect.objectContaining({ documentId: document.id, chunkIndex: 0, content: '替换段落' }),
    ]);
    expect(getDocument(document.id, db)).toEqual(
      expect.objectContaining({ chunkCount: 1, embeddingModel: 'embedding-next', embeddingDim: 1 }),
    );

    expect(deleteDocumentData(document.id, db)).toBe(true);
    expect(deleteDocumentData(document.id, db)).toBe(false);
    expect(listDocuments(db)).toEqual([]);
    expect(loadAllChunkEmbeddingRecords(db)).toEqual([]);
  });

  it('reports unavailable FTS without breaking sql.js fallback', () => {
    expect(hasDocumentChunksFts(db)).toBe(false);
    expect(searchDocumentChunkFtsRanks('"测试"', 5, undefined, db)).toBeNull();
    expect(rebuildFtsIndex([], db)).toBe(false);
  });

  it('rolls back the document and all chunks when insertion fails midway', () => {
    db.exec(`
      CREATE TRIGGER fail_second_rag_chunk
      BEFORE INSERT ON document_chunks
      WHEN NEW.chunk_index = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced rag insert failure');
      END;
    `);

    expect(() =>
      insertDocumentWithChunks(
        {
          filename: 'broken.md',
          filepath: 'knowledge/broken.md',
          mimeType: 'text/markdown',
          chunks: [
            { content: 'one', embedding: new Uint8Array([1, 0, 0, 0]), ftsText: 'one' },
            { content: 'two', embedding: new Uint8Array([2, 0, 0, 0]), ftsText: 'two' },
          ],
        },
        db,
      ),
    ).toThrow('forced rag insert failure');

    expect(listDocuments(db)).toEqual([]);
    expect(loadAllChunkEmbeddingRecords(db)).toEqual([]);
  });
});
