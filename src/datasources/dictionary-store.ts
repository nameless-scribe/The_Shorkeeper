/**
 * 字典的持久化：data_dictionary 表的条目 ↔ DataDictionary。
 * 表条目：object_key = 表名，auto = TableSkeleton（含列骨架），manual = TableManual。
 * 列条目：object_key = 表.列，auto = ColumnSkeleton，manual = ColumnManual。
 * 刷新骨架时人工层保留（mergeSkeleton 已处理），消失的表列连人工层一起删。
 */
import type { AppDatabase } from '../db';
import {
  listDictionaryEntries,
  listMetrics,
  replaceDictionaryEntries,
  updateDictionaryManualLayer,
  type DictionaryEntry,
} from '../db/repositories/datasources';
import {
  emptyManual,
  mergeSkeleton,
  type ColumnManual,
  type ColumnSkeleton,
  type DataDictionary,
  type DictionaryTable,
  type MetricDefinition,
  type TableManual,
  type TableSkeleton,
} from './dictionary';

function isTableKey(key: string): boolean {
  return !key.includes('.');
}

export function dictionaryFromEntries(sourceId: string, entries: DictionaryEntry[], metrics: MetricDefinition[]): DataDictionary {
  const tables: Record<string, DictionaryTable> = {};
  for (const entry of entries) {
    if (!isTableKey(entry.objectKey)) continue;
    const auto = entry.auto as unknown as Partial<TableSkeleton>;
    const manual = entry.manual as unknown as Partial<TableManual>;
    tables[entry.objectKey] = {
      auto: {
        name: entry.objectKey,
        columns: Array.isArray(auto.columns) ? (auto.columns as ColumnSkeleton[]) : [],
        foreignKeys: Array.isArray(auto.foreignKeys) ? auto.foreignKeys : [],
        ...(typeof auto.rowCountEstimate === 'number' ? { rowCountEstimate: auto.rowCountEstimate } : {}),
        ...(auto.comment ? { comment: auto.comment } : {}),
      },
      manual: { ...emptyManual(), ...manual, joins: Array.isArray(manual.joins) ? manual.joins : [] },
      columns: {},
    };
  }
  for (const entry of entries) {
    if (isTableKey(entry.objectKey)) continue;
    const dot = entry.objectKey.indexOf('.');
    const tableName = entry.objectKey.slice(0, dot);
    const columnName = entry.objectKey.slice(dot + 1);
    const table = tables[tableName];
    if (!table) continue;
    const manual = entry.manual as ColumnManual;
    if (Object.keys(manual).length) table.columns[columnName] = manual;
  }
  return { sourceId, tables, metrics };
}

export function entriesFromDictionary(dictionary: DataDictionary): Array<{ objectKey: string; auto: Record<string, unknown>; manual: Record<string, unknown> }> {
  const entries: Array<{ objectKey: string; auto: Record<string, unknown>; manual: Record<string, unknown> }> = [];
  for (const [name, table] of Object.entries(dictionary.tables)) {
    entries.push({ objectKey: name, auto: table.auto as unknown as Record<string, unknown>, manual: table.manual as unknown as Record<string, unknown> });
    for (const column of table.auto.columns) {
      entries.push({
        objectKey: `${name}.${column.name}`,
        auto: column as unknown as Record<string, unknown>,
        manual: (table.columns[column.name] ?? {}) as Record<string, unknown>,
      });
    }
  }
  return entries;
}

export function loadDictionary(sourceId: string, db?: AppDatabase): DataDictionary {
  const entries = listDictionaryEntries(sourceId, db);
  const metrics: MetricDefinition[] = listMetrics(sourceId, db).map((metric) => ({
    name: metric.name,
    sqlFragment: metric.sqlFragment,
    ...(metric.grain ? { grain: metric.grain } : {}),
    ...(metric.notes ? { notes: metric.notes } : {}),
    source: metric.source,
  }));
  return dictionaryFromEntries(sourceId, entries, metrics);
}

/** 刷新骨架：与已有人工层合并后整份写回。取值表跟着骨架走（knownValues 在列骨架上）。 */
export function saveSkeleton(sourceId: string, skeleton: TableSkeleton[], db?: AppDatabase): DataDictionary {
  const previous = loadDictionary(sourceId, db);
  const merged = mergeSkeleton(sourceId, skeleton, previous);
  replaceDictionaryEntries(sourceId, entriesFromDictionary(merged), db);
  return merged;
}

const TABLE_MANUAL_KEYS: Array<keyof TableManual> = ['businessName', 'description', 'isSource', 'timeColumn', 'focused', 'joins'];
const COLUMN_MANUAL_KEYS: Array<keyof ColumnManual> = ['businessName', 'description', 'enumValues', 'knownValues'];

function pick<T extends object>(input: Partial<T>, keys: Array<keyof T>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) result[key as string] = input[key];
  }
  return result;
}

export function updateTableManual(sourceId: string, table: string, patch: Partial<TableManual>, db?: AppDatabase): DataDictionary {
  updateDictionaryManualLayer(sourceId, table, pick(patch, TABLE_MANUAL_KEYS), db);
  return loadDictionary(sourceId, db);
}

export function updateColumnManual(sourceId: string, table: string, column: string, patch: Partial<ColumnManual>, db?: AppDatabase): DataDictionary {
  updateDictionaryManualLayer(sourceId, `${table}.${column}`, pick(patch, COLUMN_MANUAL_KEYS), db);
  return loadDictionary(sourceId, db);
}
