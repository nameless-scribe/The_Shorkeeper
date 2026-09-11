import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { BetterSqliteDatabase } from '../src/db/native-adapter';
import {
  deleteDocumentData,
  getChunkSearchRows,
  insertDocumentWithChunks,
  searchDocumentChunkFtsRanks,
} from '../src/db/repositories/rag-documents';
import { listProfileEntries, setProfileValue } from '../src/db/repositories/user-profile';
import { deserializeEmbedding, serializeEmbedding } from '../src/rag/vector';

interface NativeStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  iterate(...params: unknown[]): IterableIterator<unknown>;
  run(...params: unknown[]): unknown;
}

interface NativeDatabase {
  backup(destinationPath: string): Promise<unknown>;
  close(): void;
  exec(sql: string): void;
  serialize(): Buffer;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): NativeStatement;
  transaction<T>(operation: () => T): () => T;
}

type NativeDatabaseConstructor = new (filename: string) => NativeDatabase;

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as NativeDatabaseConstructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function removeTemporaryDirectory(directory: string): void {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemp = path.resolve(os.tmpdir());
  assert(
    resolvedDirectory.startsWith(`${resolvedTemp}${path.sep}`) &&
      path.basename(resolvedDirectory).startsWith('shorekeeper-native-poc-'),
    `拒绝清理非 PoC 临时目录: ${resolvedDirectory}`,
  );
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-native-poc-'));
  const databasePath = path.join(temporaryDirectory, 'poc.db');
  const backupPath = path.join(temporaryDirectory, 'poc.backup.db');
  const native = new BetterSqlite3(databasePath);
  const db = new BetterSqliteDatabase(native);

  try {
    native.pragma('foreign_keys = ON');
    const journalMode = String(native.pragma('journal_mode = WAL', { simple: true }));
    const sqliteVersion = String(
      db.prepare('SELECT sqlite_version() AS version').get()?.version ?? 'unknown',
    );
    const fts5Enabled =
      Number(
        db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()?.enabled,
      ) === 1;

    db.exec(`
      CREATE TABLE user_profile (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE vector_probe (id TEXT PRIMARY KEY, embedding BLOB NOT NULL);
      CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE benchmark_chunks (id INTEGER PRIMARY KEY, content TEXT NOT NULL);
      CREATE VIRTUAL TABLE search_probe USING fts5(content, tokenize='trigram');
      CREATE TABLE documents (
        id TEXT PRIMARY KEY NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mime_type TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        imported_at INTEGER NOT NULL,
        content_hash TEXT,
        embedding_model TEXT,
        embedding_dim INTEGER,
        summary TEXT,
        outline TEXT,
        embedding BLOB
      );
      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        content,
        filename,
        tokenize='trigram'
      );
    `);

    setProfileValue('assistant.name', '守岸人', db);
    const profile = listProfileEntries(db);
    assert(profile.length === 1 && profile[0].value === '守岸人', 'Repository 注入验证失败');

    db.prepare('INSERT INTO search_probe(content) VALUES (?)').run(
      '守岸人正在整理私人知识库文档',
    );
    const ftsHit = db
      .prepare('SELECT content FROM search_probe WHERE search_probe MATCH ?')
      .get('知识库');
    assert(ftsHit?.content === '守岸人正在整理私人知识库文档', 'FTS5 trigram 检索失败');

    const ragDocument = insertDocumentWithChunks(
      {
        filename: 'private-notes.md',
        filepath: 'knowledge/private-notes.md',
        mimeType: 'text/markdown',
        embeddingModel: 'poc-embedding',
        embeddingDim: 4,
        chunks: [
          {
            content: '守岸人正在整理私人知识库文档',
            ftsText: '守岸人 私人知识库 文档整理',
            embedding: serializeEmbedding([1, 0, 0, 0]),
          },
        ],
      },
      db,
    );
    const ragRanks = searchDocumentChunkFtsRanks('"知识库"', 5, undefined, db);
    assert(ragRanks?.length === 1, 'RAG Repository FTS 检索失败');
    const ragRows = getChunkSearchRows(ragRanks.map((row) => row.chunkId), db);
    assert(
      ragRows.length === 1 && ragRows[0].documentId === ragDocument.id,
      'RAG Repository chunk 读取失败',
    );
    assert(deleteDocumentData(ragDocument.id, db), 'RAG Repository 删除失败');

    const expectedEmbedding = [0.25, -0.5, 1.5, 3.25];
    db.prepare('INSERT INTO vector_probe(id, embedding) VALUES (?, ?)').run(
      'embedding-1',
      serializeEmbedding(expectedEmbedding),
    );
    const blob = db.prepare('SELECT embedding FROM vector_probe WHERE id = ?').get('embedding-1')
      ?.embedding;
    assert(blob instanceof Uint8Array, 'BLOB 读取结果不是 Uint8Array/Buffer');
    const restoredEmbedding = [...deserializeEmbedding(blob)];
    assert(
      restoredEmbedding.every((value, index) => value === expectedEmbedding[index]),
      'Embedding BLOB 往返不一致',
    );

    try {
      db.transaction(() => {
        db.prepare('INSERT INTO transaction_probe(value) VALUES (?)').run('rollback');
        throw new Error('expected rollback');
      });
    } catch (error) {
      assert(error instanceof Error && error.message === 'expected rollback', '事务抛错异常');
    }
    const rollbackCount = Number(
      db.prepare('SELECT COUNT(*) AS count FROM transaction_probe').get()?.count,
    );
    assert(rollbackCount === 0, '事务回滚失败');

    const insertBenchmark = db.prepare(
      'INSERT INTO benchmark_chunks(id, content) VALUES (?, ?)',
    );
    const benchmarks = [1, 100, 1000].map((count) => {
      db.exec('DELETE FROM benchmark_chunks');
      const startedAt = performance.now();
      db.transaction(() => {
        for (let index = 0; index < count; index += 1) {
          insertBenchmark.run(index, `chunk-${index}-${'知识库内容'.repeat(16)}`);
        }
      });
      const elapsedMs = performance.now() - startedAt;
      const storedCount = Number(
        db.prepare('SELECT COUNT(*) AS count FROM benchmark_chunks').get()?.count,
      );
      assert(storedCount === count, `${count} 条批量写入计数不一致`);
      return { count, elapsedMs: Number(elapsedMs.toFixed(3)) };
    });

    await native.backup(backupPath);
    const backup = new BetterSqlite3(backupPath);
    let integrityCheck: unknown;
    try {
      integrityCheck = backup.pragma('integrity_check', { simple: true });
    } finally {
      backup.close();
    }
    assert(integrityCheck === 'ok', `备份完整性检查失败: ${String(integrityCheck)}`);

    console.log(
      JSON.stringify(
        {
          runtime: { node: process.versions.node, abi: process.versions.modules },
          sqliteVersion,
          journalMode,
          fts5: { compiled: fts5Enabled, trigramSearch: true },
          blobRoundTrip: { bytes: blob.byteLength, values: restoredEmbedding },
          transactionRollback: true,
          repositoryInjection: profile[0],
          ragRepository: { ftsHits: ragRanks.length, deleted: true },
          benchmarks,
          backup: { integrityCheck, sizeBytes: fs.statSync(backupPath).size },
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
    removeTemporaryDirectory(temporaryDirectory);
  }
}

void main().catch((error) => {
  console.error('[native-sqlite-poc] failed:', error);
  process.exitCode = 1;
});
