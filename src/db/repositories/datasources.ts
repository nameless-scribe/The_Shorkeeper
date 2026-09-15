/**
 * P7 数据源查询的五张表（计划 §3.8）。只在这里写 SQL。
 * 密码走 protectSecret；列表接口不回传密码，只回传"是否已配置"。
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type AppDatabase } from '../index';
import type { DataDictionaryRow, DataSourceRow, MetricRow, NamedQueryRow, QueryRunRow } from '../schema';
import { protectSecret, revealSecret } from '../../security/secret-storage';
import type { MetricSource } from '../../datasources/dictionary';

// ---------------------------------------------------------------------------
// data_sources
// ---------------------------------------------------------------------------

export interface DataSourceOptions {
  ssl?: boolean;
  timeZone?: string;
  sampleValues?: boolean;
  focusTables?: string[];
  connectTimeoutMs?: number;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  kind: 'mysql';
  host: string;
  port: number;
  database: string;
  user: string;
  passwordConfigured: boolean;
  options: DataSourceOptions;
  lastOkAt: number | null;
  lastError: string | null;
  /** null = 未探测 */
  writableAccount: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDataSourceInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  options?: DataSourceOptions;
  now?: number;
}

export interface UpdateDataSourcePatch {
  name?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** 留空不改 */
  password?: string;
  options?: DataSourceOptions;
}

const ERROR_MAX = 300;

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max).join('')}…`;
}

/** 适配器的 run() 不返回影响行数：删改前先数一遍，两种适配器行为一致 */
function countRows(db: AppDatabase, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToDataSource(row: DataSourceRow): DataSourceInfo {
  return {
    id: row.id,
    name: row.name,
    kind: 'mysql',
    host: row.host,
    port: row.port,
    database: row.database_name,
    user: row.user,
    passwordConfigured: row.password.length > 0,
    options: parseJson<DataSourceOptions>(row.options_json, {}),
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    writableAccount: row.writable_account == null ? null : row.writable_account === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDataSource(input: CreateDataSourceInput, db: AppDatabase = getDatabase()): DataSourceInfo {
  const id = input.id ?? uuidv4();
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO data_sources
       (id, name, kind, host, port, database_name, user, password, options_json, created_at, updated_at)
     VALUES (?, ?, 'mysql', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.host.trim(),
    input.port ?? 3306,
    input.database.trim(),
    input.user.trim(),
    input.password ? protectSecret(input.password) : '',
    JSON.stringify(input.options ?? {}),
    now,
    now,
  );
  return getDataSource(id, db)!;
}

export function getDataSource(id: string, db: AppDatabase = getDatabase()): DataSourceInfo | null {
  const row = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as DataSourceRow | undefined;
  return row ? rowToDataSource(row) : null;
}

export function listDataSources(db: AppDatabase = getDatabase()): DataSourceInfo[] {
  const rows = db.prepare('SELECT * FROM data_sources ORDER BY created_at ASC').all() as unknown as DataSourceRow[];
  return rows.map(rowToDataSource);
}

/** 连接层专用：拿明文密码。不得把返回值写进日志、运行记录或渲染层。 */
export function getDataSourceCredentials(
  id: string,
  db: AppDatabase = getDatabase(),
): { host: string; port: number; database: string; user: string; password: string; options: DataSourceOptions } | null {
  const row = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as DataSourceRow | undefined;
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    database: row.database_name,
    user: row.user,
    password: row.password ? revealSecret(row.password) : '',
    options: parseJson<DataSourceOptions>(row.options_json, {}),
  };
}

export function updateDataSource(id: string, patch: UpdateDataSourcePatch, db: AppDatabase = getDatabase()): DataSourceInfo | null {
  const existing = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as DataSourceRow | undefined;
  if (!existing) return null;
  db.prepare(
    `UPDATE data_sources
     SET name = ?, host = ?, port = ?, database_name = ?, user = ?, password = ?, options_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    (patch.name ?? existing.name).trim(),
    (patch.host ?? existing.host).trim(),
    patch.port ?? existing.port,
    (patch.database ?? existing.database_name).trim(),
    (patch.user ?? existing.user).trim(),
    patch.password ? protectSecret(patch.password) : existing.password,
    JSON.stringify(patch.options ?? parseJson<DataSourceOptions>(existing.options_json, {})),
    Date.now(),
    id,
  );
  return getDataSource(id, db);
}

export function markDataSourceStatus(
  id: string,
  status: { ok: true; writableAccount?: boolean } | { ok: false; error: string },
  db: AppDatabase = getDatabase(),
): void {
  const now = Date.now();
  if (status.ok) {
    db.prepare(
      'UPDATE data_sources SET last_ok_at = ?, last_error = NULL, writable_account = ?, updated_at = ? WHERE id = ?',
    ).run(now, status.writableAccount == null ? null : status.writableAccount ? 1 : 0, now, id);
  } else {
    db.prepare('UPDATE data_sources SET last_error = ?, updated_at = ? WHERE id = ?').run(clip(status.error, ERROR_MAX), now, id);
  }
}

/** 删除数据源及其字典、指标、命名查询；查询记录保留（运行记录要能回看）。 */
export function deleteDataSource(id: string, db: AppDatabase = getDatabase()): boolean {
  return db.transaction(() => {
    const removed = countRows(db, 'SELECT COUNT(*) AS n FROM data_sources WHERE id = ?', id) > 0;
    db.prepare('DELETE FROM data_sources WHERE id = ?').run(id);
    db.prepare('DELETE FROM data_dictionary WHERE data_source_id = ?').run(id);
    db.prepare('DELETE FROM metrics WHERE data_source_id = ?').run(id);
    db.prepare('DELETE FROM named_queries WHERE data_source_id = ?').run(id);
    return removed;
  });
}

// ---------------------------------------------------------------------------
// data_dictionary
// ---------------------------------------------------------------------------

export interface DictionaryEntry {
  objectKey: string;
  auto: Record<string, unknown>;
  manual: Record<string, unknown>;
  updatedAt: number;
}

function rowToEntry(row: DataDictionaryRow): DictionaryEntry {
  return {
    objectKey: row.object_key,
    auto: parseJson<Record<string, unknown>>(row.auto_json, {}),
    manual: parseJson<Record<string, unknown>>(row.manual_json, {}),
    updatedAt: row.updated_at,
  };
}

export function listDictionaryEntries(sourceId: string, db: AppDatabase = getDatabase()): DictionaryEntry[] {
  const rows = db
    .prepare('SELECT * FROM data_dictionary WHERE data_source_id = ? ORDER BY object_key ASC')
    .all(sourceId) as unknown as DataDictionaryRow[];
  return rows.map(rowToEntry);
}

/**
 * 刷新骨架：给出的对象键整份替换 auto 层、保留 manual 层；不在列表里的旧条目删除
 * （表已不存在时人工层没有意义）。
 */
export function replaceDictionaryAutoLayer(
  sourceId: string,
  entries: Array<{ objectKey: string; auto: Record<string, unknown> }>,
  db: AppDatabase = getDatabase(),
): void {
  const now = Date.now();
  db.transaction(() => {
    const keep = new Set(entries.map((entry) => entry.objectKey));
    const existing = db
      .prepare('SELECT object_key FROM data_dictionary WHERE data_source_id = ?')
      .all(sourceId) as Array<{ object_key: string }>;
    for (const row of existing) {
      if (!keep.has(row.object_key)) {
        db.prepare('DELETE FROM data_dictionary WHERE data_source_id = ? AND object_key = ?').run(sourceId, row.object_key);
      }
    }
    const upsert = db.prepare(
      `INSERT INTO data_dictionary (id, data_source_id, object_key, auto_json, manual_json, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?)
       ON CONFLICT (data_source_id, object_key) DO UPDATE SET auto_json = excluded.auto_json, updated_at = excluded.updated_at`,
    );
    for (const entry of entries) {
      upsert.run(uuidv4(), sourceId, entry.objectKey, JSON.stringify(entry.auto), now);
    }
  });
}

/** 写人工层：只覆盖给出的字段，其余保留；条目不存在时创建（auto 为空）。 */
export function updateDictionaryManualLayer(
  sourceId: string,
  objectKey: string,
  manual: Record<string, unknown>,
  db: AppDatabase = getDatabase(),
): DictionaryEntry {
  const now = Date.now();
  const existing = db
    .prepare('SELECT * FROM data_dictionary WHERE data_source_id = ? AND object_key = ?')
    .get(sourceId, objectKey) as DataDictionaryRow | undefined;
  const merged = { ...(existing ? parseJson<Record<string, unknown>>(existing.manual_json, {}) : {}), ...manual };
  if (existing) {
    db.prepare('UPDATE data_dictionary SET manual_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO data_dictionary (id, data_source_id, object_key, auto_json, manual_json, updated_at) VALUES (?, ?, ?, '{}', ?, ?)`,
    ).run(uuidv4(), sourceId, objectKey, JSON.stringify(merged), now);
  }
  const row = db
    .prepare('SELECT * FROM data_dictionary WHERE data_source_id = ? AND object_key = ?')
    .get(sourceId, objectKey) as unknown as DataDictionaryRow;
  return rowToEntry(row);
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

export interface MetricInfo {
  id: string;
  sourceId: string;
  name: string;
  sqlFragment: string;
  grain: string | null;
  notes: string | null;
  source: MetricSource;
  updatedAt: number;
}

function rowToMetric(row: MetricRow): MetricInfo {
  return {
    id: row.id,
    sourceId: row.data_source_id,
    name: row.name,
    sqlFragment: row.sql_fragment,
    grain: row.grain,
    notes: row.notes,
    source: row.source === 'query' ? 'query' : 'user',
    updatedAt: row.updated_at,
  };
}

export function upsertMetric(
  input: { sourceId: string; name: string; sqlFragment: string; grain?: string | null; notes?: string | null; source?: MetricSource },
  db: AppDatabase = getDatabase(),
): MetricInfo {
  const now = Date.now();
  db.prepare(
    `INSERT INTO metrics (id, data_source_id, name, sql_fragment, grain, notes, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (data_source_id, name) DO UPDATE SET
       sql_fragment = excluded.sql_fragment, grain = excluded.grain, notes = excluded.notes,
       source = excluded.source, updated_at = excluded.updated_at`,
  ).run(uuidv4(), input.sourceId, input.name.trim(), input.sqlFragment.trim(), input.grain ?? null, input.notes ?? null, input.source ?? 'user', now);
  const row = db.prepare('SELECT * FROM metrics WHERE data_source_id = ? AND name = ?').get(input.sourceId, input.name.trim()) as unknown as MetricRow;
  return rowToMetric(row);
}

export function listMetrics(sourceId: string, db: AppDatabase = getDatabase()): MetricInfo[] {
  const rows = db.prepare('SELECT * FROM metrics WHERE data_source_id = ? ORDER BY name ASC').all(sourceId) as unknown as MetricRow[];
  return rows.map(rowToMetric);
}

export function deleteMetric(sourceId: string, name: string, db: AppDatabase = getDatabase()): boolean {
  const existed = countRows(db, 'SELECT COUNT(*) AS n FROM metrics WHERE data_source_id = ? AND name = ?', sourceId, name.trim()) > 0;
  db.prepare('DELETE FROM metrics WHERE data_source_id = ? AND name = ?').run(sourceId, name.trim());
  return existed;
}

// ---------------------------------------------------------------------------
// named_queries
// ---------------------------------------------------------------------------

export interface NamedQueryInfo {
  id: string;
  sourceId: string;
  name: string;
  question: string;
  planJson: string;
  sql: string;
  notes: string | null;
  hasEmbedding: boolean;
  createdAt: number;
  lastRunAt: number | null;
  lastRowCount: number | null;
}

function rowToNamedQuery(row: NamedQueryRow): NamedQueryInfo {
  return {
    id: row.id,
    sourceId: row.data_source_id,
    name: row.name,
    question: row.question,
    planJson: row.plan_json,
    sql: row.sql,
    notes: row.notes,
    hasEmbedding: row.question_embedding != null,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    lastRowCount: row.last_row_count,
  };
}

export function saveNamedQuery(
  input: { id?: string; sourceId: string; name: string; question: string; planJson: string; sql: string; notes?: string | null; embedding?: Float32Array | null },
  db: AppDatabase = getDatabase(),
): NamedQueryInfo {
  const id = input.id ?? uuidv4();
  const embedding = input.embedding ? Buffer.from(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength) : null;
  db.prepare(
    `INSERT INTO named_queries (id, data_source_id, name, question, plan_json, sql, notes, question_embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, question = excluded.question, plan_json = excluded.plan_json, sql = excluded.sql,
       notes = excluded.notes, question_embedding = excluded.question_embedding`,
  ).run(id, input.sourceId, input.name.trim(), input.question.trim(), input.planJson, input.sql, input.notes ?? null, embedding, Date.now());
  return getNamedQuery(id, db)!;
}

export function getNamedQuery(id: string, db: AppDatabase = getDatabase()): NamedQueryInfo | null {
  const row = db.prepare('SELECT * FROM named_queries WHERE id = ?').get(id) as NamedQueryRow | undefined;
  return row ? rowToNamedQuery(row) : null;
}

export function listNamedQueries(sourceId: string, db: AppDatabase = getDatabase()): NamedQueryInfo[] {
  const rows = db
    .prepare('SELECT * FROM named_queries WHERE data_source_id = ? ORDER BY created_at DESC')
    .all(sourceId) as unknown as NamedQueryRow[];
  return rows.map(rowToNamedQuery);
}

/** 相似检索用：取该数据源所有带向量的命名查询 */
export function listNamedQueryEmbeddings(sourceId: string, db: AppDatabase = getDatabase()): Array<{ id: string; embedding: Float32Array }> {
  const rows = db
    .prepare('SELECT id, question_embedding FROM named_queries WHERE data_source_id = ? AND question_embedding IS NOT NULL')
    .all(sourceId) as Array<{ id: string; question_embedding: Uint8Array | Buffer }>;
  return rows.map((row) => {
    const bytes = row.question_embedding instanceof Uint8Array ? row.question_embedding : new Uint8Array(row.question_embedding);
    const aligned = bytes.byteOffset % 4 === 0 ? bytes : new Uint8Array(bytes);
    return { id: row.id, embedding: new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4)) };
  });
}

export function touchNamedQueryRun(id: string, rowCount: number, db: AppDatabase = getDatabase()): void {
  db.prepare('UPDATE named_queries SET last_run_at = ?, last_row_count = ? WHERE id = ?').run(Date.now(), rowCount, id);
}

export function deleteNamedQuery(id: string, db: AppDatabase = getDatabase()): boolean {
  const existed = countRows(db, 'SELECT COUNT(*) AS n FROM named_queries WHERE id = ?', id) > 0;
  db.prepare('DELETE FROM named_queries WHERE id = ?').run(id);
  return existed;
}

// ---------------------------------------------------------------------------
// query_runs
// ---------------------------------------------------------------------------

export type QueryRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface QueryRunInfo {
  id: string;
  runId: string | null;
  sourceId: string;
  namedQueryId: string | null;
  planJson: string;
  sql: string;
  status: QueryRunStatus;
  rowCount: number | null;
  durationMs: number | null;
  artifactPath: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function rowToQueryRun(row: QueryRunRow): QueryRunInfo {
  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.data_source_id,
    namedQueryId: row.named_query_id,
    planJson: row.plan_json,
    sql: row.sql,
    status: row.status as QueryRunStatus,
    rowCount: row.row_count,
    durationMs: row.duration_ms,
    artifactPath: row.artifact_path,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function startQueryRun(
  input: { id?: string; runId?: string | null; sourceId: string; namedQueryId?: string | null; planJson: string; sql: string; startedAt?: number },
  db: AppDatabase = getDatabase(),
): QueryRunInfo {
  const id = input.id ?? uuidv4();
  db.prepare(
    `INSERT INTO query_runs (id, run_id, data_source_id, named_query_id, plan_json, sql, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
  ).run(id, input.runId ?? null, input.sourceId, input.namedQueryId ?? null, input.planJson, input.sql, input.startedAt ?? Date.now());
  return getQueryRun(id, db)!;
}

export function finishQueryRun(
  id: string,
  outcome:
    | { status: 'succeeded'; rowCount: number; durationMs: number; artifactPath?: string | null }
    | { status: 'failed' | 'cancelled'; error: string; durationMs?: number },
  db: AppDatabase = getDatabase(),
): QueryRunInfo | null {
  const now = Date.now();
  if (outcome.status === 'succeeded') {
    db.prepare(
      `UPDATE query_runs SET status = 'succeeded', row_count = ?, duration_ms = ?, artifact_path = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(outcome.rowCount, outcome.durationMs, outcome.artifactPath ?? null, now, id);
  } else {
    db.prepare(
      `UPDATE query_runs SET status = ?, error = ?, duration_ms = ?, finished_at = ? WHERE id = ? AND status = 'running'`,
    ).run(outcome.status, clip(outcome.error, ERROR_MAX), outcome.durationMs ?? null, now, id);
  }
  return getQueryRun(id, db);
}

export function getQueryRun(id: string, db: AppDatabase = getDatabase()): QueryRunInfo | null {
  const row = db.prepare('SELECT * FROM query_runs WHERE id = ?').get(id) as QueryRunRow | undefined;
  return row ? rowToQueryRun(row) : null;
}

export function listQueryRuns(filter: { sourceId?: string; runId?: string; limit?: number }, db: AppDatabase = getDatabase()): QueryRunInfo[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.sourceId) {
    clauses.push('data_source_id = ?');
    params.push(filter.sourceId);
  }
  if (filter.runId) {
    clauses.push('run_id = ?');
    params.push(filter.runId);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 50)));
  const rows = db
    .prepare(`SELECT * FROM query_runs${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ${limit}`)
    .all(...params) as unknown as QueryRunRow[];
  return rows.map(rowToQueryRun);
}

/** 启动收口：进程退出时仍在 running 的查询记录一律标为 cancelled。 */
export function markInterruptedQueryRuns(now = Date.now(), db: AppDatabase = getDatabase()): number {
  const running = countRows(db, `SELECT COUNT(*) AS n FROM query_runs WHERE status = 'running'`);
  db.prepare(`UPDATE query_runs SET status = 'cancelled', error = '应用退出时中断', finished_at = ? WHERE status = 'running'`).run(now);
  return running;
}
