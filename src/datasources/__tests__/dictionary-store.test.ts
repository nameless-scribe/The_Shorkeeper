import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../../db';
import { createDataSource, listDictionaryEntries, upsertMetric } from '../../db/repositories/datasources';
import { loadDictionary, saveSkeleton, updateColumnManual, updateTableManual } from '../dictionary-store';
import { sampleSkeleton } from './fixtures';

interface Closable extends AppDatabase {
  close(): void;
}

let tempDir: string;
let db: Closable | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function open(): Promise<Closable> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-dict-'));
  db = (await openDatabase(path.join(tempDir, 'dict.db'))) as Closable;
  return db;
}

describe('dictionary store', () => {
  it('round-trips a skeleton through the repository with comments promoted to business names', async () => {
    const database = await open();
    const source = createDataSource({ name: 's', host: 'h', database: 'erp', user: 'u', password: 'p' }, database);
    const saved = saveSkeleton(source.id, sampleSkeleton(), database);
    expect(Object.keys(saved.tables).sort()).toEqual(['customers', 'orders']);

    const loaded = loadDictionary(source.id, database);
    expect(loaded.tables.orders.manual.businessName).toBe('订单');
    expect(loaded.tables.orders.columns.status.businessName).toBe('状态');
    expect(loaded.tables.orders.auto.columns.map((column) => column.name)).toContain('paid_at');
    expect(loaded.tables.orders.auto.rowCountEstimate).toBe(120_000);
    expect(loaded.tables.orders.manual.joins).toEqual([
      { id: 'orders.customer_id->customers.id', fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', cardinality: 'N:1' },
    ]);
    // 表条目 + 列条目
    expect(listDictionaryEntries(source.id, database)).toHaveLength(2 + 7 + 3);
  });

  it('keeps the manual layer across a refresh, drops entries for vanished columns and replaces known values', async () => {
    const database = await open();
    const source = createDataSource({ name: 's', host: 'h', database: 'erp', user: 'u', password: 'p' }, database);
    const first = sampleSkeleton();
    first[0].columns.find((column) => column.name === 'region')!.knownValues = ['华东', '华北'];
    saveSkeleton(source.id, first, database);
    updateTableManual(source.id, 'orders', { businessName: '销售订单', timeColumn: 'paid_at', focused: true }, database);
    updateColumnManual(source.id, 'orders', 'status', { enumValues: { '1': '待付款', '2': '已付款' } }, database);
    updateColumnManual(source.id, 'orders', 'refund_amount', { businessName: '退款金额' }, database);

    const second = sampleSkeleton();
    second[0].columns = second[0].columns.filter((column) => column.name !== 'refund_amount');
    second[0].columns.find((column) => column.name === 'region')!.knownValues = ['华东', '华南'];
    second[0].columns.find((column) => column.name === 'status')!.knownValues = ['1', '2', '3'];
    const refreshed = saveSkeleton(source.id, second, database);

    expect(refreshed.tables.orders.manual.businessName).toBe('销售订单');
    expect(refreshed.tables.orders.manual.timeColumn).toBe('paid_at');
    expect(refreshed.tables.orders.manual.focused).toBe(true);
    expect(refreshed.tables.orders.columns.status.enumValues).toEqual({ '1': '待付款', '2': '已付款' });
    expect(refreshed.tables.orders.columns.status.knownValues).toEqual(['1', '2', '3']);
    expect(refreshed.tables.orders.columns.region.knownValues).toEqual(['华东', '华南']);
    expect(refreshed.tables.orders.columns.refund_amount).toBeUndefined();
    expect(listDictionaryEntries(source.id, database).some((entry) => entry.objectKey === 'orders.refund_amount')).toBe(false);

    const reloaded = loadDictionary(source.id, database);
    expect(reloaded.tables.orders.columns.status.knownValues).toEqual(['1', '2', '3']);
  });

  it('clears a column value table when the column stops being enum-like', async () => {
    const database = await open();
    const source = createDataSource({ name: 's', host: 'h', database: 'erp', user: 'u', password: 'p' }, database);
    const first = sampleSkeleton();
    first[0].columns.find((column) => column.name === 'region')!.knownValues = ['华东'];
    saveSkeleton(source.id, first, database);
    const refreshed = saveSkeleton(source.id, sampleSkeleton(), database);
    expect(refreshed.tables.orders.columns.region?.knownValues).toBeUndefined();
  });

  it('includes metrics from the metrics table and ignores unknown manual keys', async () => {
    const database = await open();
    const source = createDataSource({ name: 's', host: 'h', database: 'erp', user: 'u', password: 'p' }, database);
    saveSkeleton(source.id, sampleSkeleton(), database);
    upsertMetric({ sourceId: source.id, name: '销售额', sqlFragment: 'SUM(f.paid_amount)', grain: '订单', notes: '含税' }, database);
    const withUnknown = updateTableManual(source.id, 'orders', { businessName: 'x', ...({ junk: 1 } as object) }, database);
    expect((withUnknown.tables.orders.manual as unknown as Record<string, unknown>).junk).toBeUndefined();
    const dictionary = loadDictionary(source.id, database);
    expect(dictionary.metrics).toEqual([{ name: '销售额', sqlFragment: 'SUM(f.paid_amount)', grain: '订单', notes: '含税', source: 'user' }]);
  });
});
