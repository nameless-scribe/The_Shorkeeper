import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../index';
import { openNativeDatabase } from '../native-adapter';
import {
  createDataSource,
  deleteDataSource,
  deleteMetric,
  finishQueryRun,
  getDataSource,
  getDataSourceCredentials,
  listDataSources,
  listDictionaryEntries,
  listMetrics,
  listNamedQueries,
  listNamedQueryEmbeddings,
  listQueryRuns,
  markDataSourceStatus,
  markInterruptedQueryRuns,
  replaceDictionaryAutoLayer,
  saveNamedQuery,
  startQueryRun,
  touchNamedQueryRun,
  updateDataSource,
  updateDictionaryManualLayer,
  upsertMetric,
} from '../repositories/datasources';

interface ContractDatabase extends AppDatabase {
  close(): void;
}

const adapters = [
  { name: 'sql.js', open: (dbPath: string) => openDatabase(dbPath) },
  { name: 'better-sqlite3', open: async (dbPath: string) => openNativeDatabase(dbPath) },
] as const;

for (const adapter of adapters) {
  describe(`P7 data source tables (${adapter.name})`, () => {
    let tempDir: string;
    let db: ContractDatabase | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function open(): Promise<ContractDatabase> {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-p7-'));
      db = (await adapter.open(path.join(tempDir, 'p7.db'))) as ContractDatabase;
      return db;
    }

    it('stores a data source with a protected password and never lists the secret', async () => {
      const database = await open();
      const source = createDataSource({ name: '生产库', host: '10.0.0.5', database: 'erp', user: 'reader', password: 'p@ss', options: { timeZone: '+08:00', sampleValues: true } }, database);
      expect(source).toMatchObject({ name: '生产库', host: '10.0.0.5', port: 3306, database: 'erp', user: 'reader', passwordConfigured: true, writableAccount: null, lastOkAt: null });
      expect(source.options).toEqual({ timeZone: '+08:00', sampleValues: true });
      expect(JSON.stringify(listDataSources(database))).not.toContain('p@ss');
      expect(getDataSourceCredentials(source.id, database)?.password).toBe('p@ss');

      // 留空不改密码；其它字段更新
      const updated = updateDataSource(source.id, { name: '生产库（只读）', port: 3307, password: '' }, database)!;
      expect(updated.name).toBe('生产库（只读）');
      expect(updated.port).toBe(3307);
      expect(getDataSourceCredentials(source.id, database)?.password).toBe('p@ss');
      updateDataSource(source.id, { password: 'new' }, database);
      expect(getDataSourceCredentials(source.id, database)?.password).toBe('new');

      markDataSourceStatus(source.id, { ok: true, writableAccount: true }, database);
      expect(getDataSource(source.id, database)).toMatchObject({ writableAccount: true, lastError: null });
      expect(getDataSource(source.id, database)?.lastOkAt).not.toBeNull();
      markDataSourceStatus(source.id, { ok: false, error: 'x'.repeat(400) }, database);
      expect(getDataSource(source.id, database)?.lastError?.length).toBe(301);
    });

    it('keeps the manual dictionary layer across skeleton refreshes and drops vanished objects', async () => {
      const database = await open();
      const source = createDataSource({ name: 's', host: 'h', database: 'd', user: 'u', password: '' }, database);
      replaceDictionaryAutoLayer(source.id, [
        { objectKey: 'orders', auto: { columns: ['id', 'status'] } },
        { objectKey: 'orders.status', auto: { type: 'tinyint' } },
        { objectKey: 'legacy', auto: {} },
      ], database);
      updateDictionaryManualLayer(source.id, 'orders', { businessName: '订单', timeColumn: 'paid_at' }, database);
      updateDictionaryManualLayer(source.id, 'orders', { isSource: true }, database);
      updateDictionaryManualLayer(source.id, 'orders.status', { enumValues: { '1': '待付款' } }, database);

      replaceDictionaryAutoLayer(source.id, [
        { objectKey: 'orders', auto: { columns: ['id', 'status', 'region'] } },
        { objectKey: 'orders.status', auto: { type: 'tinyint' } },
      ], database);
      const entries = listDictionaryEntries(source.id, database);
      expect(entries.map((entry) => entry.objectKey)).toEqual(['orders', 'orders.status']);
      expect(entries[0].auto).toEqual({ columns: ['id', 'status', 'region'] });
      expect(entries[0].manual).toEqual({ businessName: '订单', timeColumn: 'paid_at', isSource: true });
      expect(entries[1].manual).toEqual({ enumValues: { '1': '待付款' } });
      // 人工层可以先于骨架存在
      updateDictionaryManualLayer(source.id, 'customers', { businessName: '客户' }, database);
      expect(listDictionaryEntries(source.id, database).find((e) => e.objectKey === 'customers')?.auto).toEqual({});
    });

    it('upserts metrics by name per source', async () => {
      const database = await open();
      const source = createDataSource({ name: 's', host: 'h', database: 'd', user: 'u', password: '' }, database);
      upsertMetric({ sourceId: source.id, name: '销售额', sqlFragment: 'SUM(f.amount)', notes: '不含税' }, database);
      upsertMetric({ sourceId: source.id, name: '销售额', sqlFragment: 'SUM(f.amount - f.refund)', notes: '含税，扣退款', source: 'query' }, database);
      upsertMetric({ sourceId: source.id, name: '订单数', sqlFragment: 'COUNT(DISTINCT f.id)' }, database);
      expect(listMetrics(source.id, database).map((m) => `${m.name}=${m.sqlFragment}/${m.source}`)).toEqual([
        '订单数=COUNT(DISTINCT f.id)/user',
        '销售额=SUM(f.amount - f.refund)/query',
      ]);
      expect(deleteMetric(source.id, '订单数', database)).toBe(true);
      expect(deleteMetric(source.id, '订单数', database)).toBe(false);
    });

    it('saves named queries with an optional embedding and records runs without result data', async () => {
      const database = await open();
      const source = createDataSource({ name: 's', host: 'h', database: 'd', user: 'u', password: '' }, database);
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const saved = saveNamedQuery({ sourceId: source.id, name: '月销售额', question: '上个月销售额', planJson: '{"limit":10}', sql: 'SELECT 1', embedding }, database);
      expect(saved.hasEmbedding).toBe(true);
      const vectors = listNamedQueryEmbeddings(source.id, database);
      expect(vectors).toHaveLength(1);
      expect([...vectors[0].embedding].map((v) => Number(v.toFixed(3)))).toEqual([0.1, 0.2, 0.3]);
      saveNamedQuery({ id: saved.id, sourceId: source.id, name: '月销售额（含税）', question: '上个月含税销售额', planJson: '{}', sql: 'SELECT 2' }, database);
      expect(listNamedQueries(source.id, database)).toHaveLength(1);
      expect(listNamedQueries(source.id, database)[0]).toMatchObject({ name: '月销售额（含税）', sql: 'SELECT 2', hasEmbedding: false });

      const run = startQueryRun({ runId: 'run-1', sourceId: source.id, namedQueryId: saved.id, planJson: '{}', sql: 'SELECT 2' }, database);
      expect(run.status).toBe('running');
      const finished = finishQueryRun(run.id, { status: 'succeeded', rowCount: 42, durationMs: 120, artifactPath: 'exports/q.csv' }, database)!;
      expect(finished).toMatchObject({ status: 'succeeded', rowCount: 42, durationMs: 120, artifactPath: 'exports/q.csv' });
      touchNamedQueryRun(saved.id, 42, database);
      expect(listNamedQueries(source.id, database)[0].lastRowCount).toBe(42);
      // 结束后再改无效
      finishQueryRun(run.id, { status: 'failed', error: 'late' }, database);
      expect(listQueryRuns({ runId: 'run-1' }, database)[0].status).toBe('succeeded');

      const stuck = startQueryRun({ sourceId: source.id, planJson: '{}', sql: 'SELECT 3' }, database);
      expect(markInterruptedQueryRuns(Date.now(), database)).toBe(1);
      expect(listQueryRuns({ sourceId: source.id }, database).find((r) => r.id === stuck.id)).toMatchObject({ status: 'cancelled', error: '应用退出时中断' });
    });

    it('deletes a source together with its dictionary, metrics and named queries but keeps query runs', async () => {
      const database = await open();
      const source = createDataSource({ name: 's', host: 'h', database: 'd', user: 'u', password: '' }, database);
      updateDictionaryManualLayer(source.id, 'orders', { businessName: '订单' }, database);
      upsertMetric({ sourceId: source.id, name: 'm', sqlFragment: 'COUNT(*)' }, database);
      saveNamedQuery({ sourceId: source.id, name: 'n', question: 'q', planJson: '{}', sql: 'SELECT 1' }, database);
      const run = startQueryRun({ sourceId: source.id, planJson: '{}', sql: 'SELECT 1' }, database);
      expect(deleteDataSource(source.id, database)).toBe(true);
      expect(deleteDataSource(source.id, database)).toBe(false);
      expect(listDataSources(database)).toEqual([]);
      expect(listDictionaryEntries(source.id, database)).toEqual([]);
      expect(listMetrics(source.id, database)).toEqual([]);
      expect(listNamedQueries(source.id, database)).toEqual([]);
      expect(listQueryRuns({ sourceId: source.id }, database).map((r) => r.id)).toEqual([run.id]);
    });
  });
}
