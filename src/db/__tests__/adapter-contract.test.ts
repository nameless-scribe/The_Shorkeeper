import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import { createBookkeepingEntry, listBookkeepingEntries } from '../repositories/bookkeeping';
import {
  createMemory,
  getMemoryWithEmbeddingByKey,
} from '../repositories/long-term-memory';
import { insertMessage, listMessages } from '../repositories/messages';
import {
  deleteDocumentData,
  getDocument,
  hasDocumentChunksFts,
  insertDocumentWithChunks,
  loadAllChunkEmbeddingRecords,
  searchDocumentChunkFtsRanks,
} from '../repositories/rag-documents';
import { getSessionSummary, upsertSessionSummary } from '../repositories/session-summaries';
import { createSession, getSession } from '../repositories/sessions';
import {
  deleteProfileKey,
  getProfileValue,
  setProfileValue,
} from '../repositories/user-profile';
import {
  createWorldbookEntry,
  getWorldbookEntry,
  searchWorldbookFtsIds,
} from '../repositories/worldbook';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapterFactories = [
  {
    name: 'sql.js',
    open: (dbPath: string) => openDatabase(dbPath),
  },
  {
    name: 'better-sqlite3',
    open: async (dbPath: string) => openNativeDatabase(dbPath),
  },
] as const;

for (const adapter of adapterFactories) {
  describe(`${adapter.name} adapter contract`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-${adapter.name}-contract-`));
      db = await adapter.open(path.join(tempDir, 'contract.db'));
      return db;
    }

    it('initializes the same schema and rolls back failed transactions', async () => {
      const database = await open();
      const requiredTables = [
        'sessions',
        'messages',
        'app_settings',
        'long_term_memory',
        'worldbook_entries',
        'documents',
        'document_chunks',
        'bookkeeping_entries',
        'session_summaries',
      ];
      for (const table of requiredTables) {
        expect(
          database
            .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(table)?.present,
        ).toBe(1);
      }

      expect(() =>
        database.transaction(() => {
          database
            .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
            .run('contract.rollback', 'no', Date.now());
          throw new Error('rollback contract');
        }),
      ).toThrow('rollback contract');
      expect(
        database.prepare('SELECT value FROM app_settings WHERE key = ?').get('contract.rollback'),
      ).toBeUndefined();
    });

    it('preserves repository CRUD, numeric, and BLOB behavior', async () => {
      const database = await open();

      setProfileValue('owner.name', '漂泊者', database);
      expect(getProfileValue('owner.name', database)).toBe('漂泊者');
      expect(deleteProfileKey('owner.name', database)).toBe(true);

      const session = createSession(database);
      const message = insertMessage(session.id, 'user', '记住今天的计划', 8, database);
      expect(listMessages(session.id, database).map((item) => item.id)).toEqual([message.id]);
      upsertSessionSummary(session.id, '用户制定了计划', message.id, database);
      expect(getSessionSummary(session.id, database)?.summary).toBe('用户制定了计划');
      expect(getSession(session.id, database)?.compressed).toBe(true);

      createBookkeepingEntry(
        {
          sessionId: session.id,
          category: '交通',
          amount: 12.5,
          entryType: 'expense',
        },
        database,
      );
      expect(listBookkeepingEntries(10, database)[0].amount).toBe(12.5);

      const memoryEmbedding = new Uint8Array([1, 2, 3, 4, 250]);
      createMemory(
        {
          memoryKey: 'preference.drink',
          content: '喜欢茶',
          importance: 0.8,
          embedding: memoryEmbedding,
        },
        database,
      );
      expect(
        [...(getMemoryWithEmbeddingByKey('preference.drink', database)?.embedding ?? [])],
      ).toEqual([...memoryEmbedding]);

      const worldbook = createWorldbookEntry(
        { keys: '黑海岸', content: '守岸人守护的地方' },
        database,
      );
      expect(getWorldbookEntry(worldbook.id, database)?.content).toContain('守岸人');
      const ftsIds = searchWorldbookFtsIds(['黑海岸'], database);
      if (ftsIds) expect(ftsIds).toContain(worldbook.id);
    });

    it('preserves RAG transactions, FTS capability, and embedding BLOBs', async () => {
      const database = await open();
      const embedding = new Uint8Array([0, 0, 128, 63, 0, 0, 0, 64]);
      const document = insertDocumentWithChunks(
        {
          filename: 'contract.md',
          filepath: 'knowledge/contract.md',
          mimeType: 'text/markdown',
          chunks: [
            {
              content: '守岸人在黑海岸记录潮汐。',
              ftsText: '守岸人 黑海岸 潮汐',
              embedding,
            },
          ],
          contentHash: 'adapter-contract-hash',
          embeddingModel: 'contract-model',
          embeddingDim: 2,
          docEmbedding: embedding,
        },
        database,
      );

      expect(getDocument(document.id, database)?.chunkCount).toBe(1);
      expect([...loadAllChunkEmbeddingRecords(database)[0].embedding]).toEqual([...embedding]);
      if (hasDocumentChunksFts(database)) {
        expect(searchDocumentChunkFtsRanks('黑海岸', 5, undefined, database)?.length).toBe(1);
      }
      expect(deleteDocumentData(document.id, database)).toBe(true);
      expect(getDocument(document.id, database)).toBeUndefined();
    });
  });
}

describe('better-sqlite3 existing database protection', () => {
  it('refuses to modify an existing database without explicit migration access', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-native-guard-'));
    const dbPath = path.join(tempDir, 'existing.db');
    try {
      openNativeDatabase(dbPath).close();
      const original = fs.readFileSync(dbPath);

      expect(() => openNativeDatabase(dbPath)).toThrow(
        'Opening an existing database with the native adapter requires allowExisting.',
      );
      expect(fs.readFileSync(dbPath)).toEqual(original);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
