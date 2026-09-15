import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { requireBoolean, requireEnum, requireFiniteNumber, requireRecord, requireString } from '../../src/shared/ipc-validation';
import type {
  ColumnManual,
  CreateDataSourceInput,
  DataSourceInfo,
  DataSourceOptions,
  DataSourceTestResult,
  DataDictionary,
  DictionaryJoin,
  EnumProposalResult,
  MetricInfo,
  SchemaRefreshResult,
  TableManual,
  UpdateDataSourcePatch,
} from '../../src/shared/types';
import {
  createDataSource,
  deleteDataSource,
  deleteMetric,
  getDataSource,
  listDataSources,
  listMetrics,
  markDataSourceStatus,
  updateDataSource,
  upsertMetric,
} from '../../src/db/repositories/datasources';
import { closeAllConnectors, getConnectorForSource, invalidateConnector } from '../../src/datasources/connector-registry';
import { loadDictionary, saveSkeleton, updateColumnManual, updateTableManual } from '../../src/datasources/dictionary-store';
import { describeMysqlError, sslWarning } from '../../src/datasources/mysql-helpers';
import { proposeEnumMeanings } from '../../src/datasources/enum-proposal';
import { focusedTables, joinId } from '../../src/datasources/dictionary';
import { disableNamedQueryTasksForSource } from '../../src/datasources/scheduled-named-queries';

const IDENTIFIER = /^(?![0-9]+$)[\p{L}\p{N}_$]{1,64}$/u;
/** 没有勾选关注表时，最多给这么多张表建取值表 */
const VALUES_TABLES_WITHOUT_FOCUS = 60;

function requireIdentifier(value: unknown, label: string): string {
  const text = requireString(value, label, { maxLength: 64 });
  if (!IDENTIFIER.test(text)) throw new TypeError(`${label}不是合法的表名或列名`);
  return text;
}

function optionalString(input: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  return input[key] === undefined ? undefined : requireString(input[key], key, { allowEmpty: true, maxLength });
}

function parseOptions(value: unknown): DataSourceOptions {
  const input = requireRecord(value, '数据源选项');
  const options: DataSourceOptions = {};
  if (input.ssl !== undefined) options.ssl = requireBoolean(input.ssl, 'ssl');
  if (input.sampleValues !== undefined) options.sampleValues = requireBoolean(input.sampleValues, 'sampleValues');
  if (input.timeZone !== undefined) {
    const timeZone = requireString(input.timeZone, 'timeZone', { allowEmpty: true, maxLength: 64 }).trim();
    if (timeZone && !/^([+-]\d{2}:\d{2}|[A-Za-z_]+(\/[A-Za-z_+-]+)*|SYSTEM|UTC)$/.test(timeZone)) {
      throw new TypeError('时区写成 +08:00 或 Asia/Shanghai 这样的形式，留空则跟随服务器');
    }
    if (timeZone) options.timeZone = timeZone;
  }
  if (input.connectTimeoutMs !== undefined) {
    options.connectTimeoutMs = Math.floor(requireFiniteNumber(input.connectTimeoutMs, 'connectTimeoutMs', { min: 1_000, max: 120_000 }));
  }
  return options;
}

function parseCreateInput(value: unknown): CreateDataSourceInput {
  const input = requireRecord(value, '数据源');
  return {
    name: requireString(input.name, '名称', { maxLength: 100 }),
    host: requireString(input.host, '主机', { maxLength: 255 }),
    port: input.port === undefined ? 3306 : Math.floor(requireFiniteNumber(input.port, '端口', { min: 1, max: 65_535 })),
    database: requireString(input.database, '数据库名', { maxLength: 64 }),
    user: requireString(input.user, '用户名', { maxLength: 128 }),
    password: requireString(input.password, '密码', { allowEmpty: true, maxLength: 1_000 }),
    options: input.options === undefined ? {} : parseOptions(input.options),
  };
}

function parseUpdatePatch(value: unknown): UpdateDataSourcePatch {
  const input = requireRecord(value, '数据源');
  const patch: UpdateDataSourcePatch = {};
  const name = optionalString(input, 'name', 100);
  if (name !== undefined) patch.name = requireString(name, '名称', { maxLength: 100 });
  const host = optionalString(input, 'host', 255);
  if (host !== undefined) patch.host = requireString(host, '主机', { maxLength: 255 });
  if (input.port !== undefined) patch.port = Math.floor(requireFiniteNumber(input.port, '端口', { min: 1, max: 65_535 }));
  const database = optionalString(input, 'database', 64);
  if (database !== undefined) patch.database = requireString(database, '数据库名', { maxLength: 64 });
  const user = optionalString(input, 'user', 128);
  if (user !== undefined) patch.user = requireString(user, '用户名', { maxLength: 128 });
  const password = optionalString(input, 'password', 1_000);
  if (password) patch.password = password;
  if (input.options !== undefined) patch.options = parseOptions(input.options);
  return patch;
}

function parseJoins(value: unknown): DictionaryJoin[] {
  if (!Array.isArray(value)) throw new TypeError('joins 必须是数组');
  if (value.length > 50) throw new RangeError('连接最多 50 条');
  return value.map((item, index) => {
    const input = requireRecord(item, `joins[${index}]`);
    const fromTable = requireIdentifier(input.fromTable, 'fromTable');
    const fromColumn = requireIdentifier(input.fromColumn, 'fromColumn');
    const toTable = requireIdentifier(input.toTable, 'toTable');
    const toColumn = requireIdentifier(input.toColumn, 'toColumn');
    const cardinality = requireEnum(input.cardinality, 'cardinality', ['N:1', '1:1', '1:N'] as const);
    return { id: joinId(fromTable, fromColumn, toTable, toColumn), fromTable, fromColumn, toTable, toColumn, cardinality };
  });
}

function parseTableManualPatch(value: unknown): Partial<TableManual> {
  const input = requireRecord(value, '表的字典条目');
  const patch: Partial<TableManual> = {};
  const businessName = optionalString(input, 'businessName', 100);
  if (businessName !== undefined) patch.businessName = businessName.trim();
  const description = optionalString(input, 'description', 500);
  if (description !== undefined) patch.description = description.trim();
  if (input.isSource !== undefined) patch.isSource = requireBoolean(input.isSource, 'isSource');
  if (input.focused !== undefined) patch.focused = requireBoolean(input.focused, 'focused');
  if (input.timeColumn !== undefined) {
    const timeColumn = requireString(input.timeColumn, 'timeColumn', { allowEmpty: true, maxLength: 64 }).trim();
    patch.timeColumn = timeColumn ? requireIdentifier(timeColumn, 'timeColumn') : '';
  }
  if (input.joins !== undefined) patch.joins = parseJoins(input.joins);
  return patch;
}

function parseColumnManualPatch(value: unknown): Partial<ColumnManual> {
  const input = requireRecord(value, '列的字典条目');
  const patch: Partial<ColumnManual> = {};
  const businessName = optionalString(input, 'businessName', 100);
  if (businessName !== undefined) patch.businessName = businessName.trim();
  const description = optionalString(input, 'description', 500);
  if (description !== undefined) patch.description = description.trim();
  if (input.enumValues !== undefined) {
    const record = requireRecord(input.enumValues, 'enumValues');
    const entries = Object.entries(record);
    if (entries.length > 200) throw new RangeError('枚举值最多 200 个');
    patch.enumValues = Object.fromEntries(
      entries.map(([key, meaning]) => [
        requireString(key, '枚举取值', { maxLength: 100 }),
        requireString(meaning, `枚举 ${key} 的含义`, { maxLength: 40 }).trim(),
      ]),
    );
  }
  return patch;
}

const FRAGMENT_FORBIDDEN = /;|--|\/\*|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|load|outfile|into)\b/i;

function parseMetricInput(value: unknown): { name: string; sqlFragment: string; grain?: string | null; notes?: string | null } {
  const input = requireRecord(value, '指标');
  const sqlFragment = requireString(input.sqlFragment, 'SQL 片段', { maxLength: 2_000 }).trim();
  if (FRAGMENT_FORBIDDEN.test(sqlFragment)) throw new TypeError('指标片段只能是聚合表达式，不能含分号、注释或写操作');
  return {
    name: requireString(input.name, '指标名', { maxLength: 100 }).trim(),
    sqlFragment,
    grain: optionalString(input, 'grain', 50)?.trim() || null,
    notes: optionalString(input, 'notes', 500)?.trim() || null,
  };
}

function requireSource(id: string): DataSourceInfo {
  const info = getDataSource(id);
  if (!info) throw new Error('数据源不存在');
  return info;
}

async function testDataSource(id: string): Promise<DataSourceTestResult> {
  const info = requireSource(id);
  const warnings: string[] = [];
  const ssl = sslWarning(info.host, info.options.ssl === true);
  if (ssl) warnings.push(ssl);
  const connector = getConnectorForSource(id);
  try {
    const ping = await connector.ping();
    const writable = await connector.probeWritable();
    if (writable.writable) warnings.push('这个账号有写权限。应用只会读，但建议换成只读账号，更稳妥。');
    if (writable.hasRoles) warnings.push('账号是通过角色授权的，角色里的权限这里看不出来，请自行确认它是只读的。');
    const dictionary = loadDictionary(id);
    const targets = focusedTables(dictionary)
      .map((table) => ({ table, column: dictionary.tables[table]?.manual.timeColumn ?? '' }))
      .filter((target) => target.column)
      .slice(0, 5);
    const latestTimestamps = await connector.latestTimestamps(targets);
    markDataSourceStatus(id, { ok: true, writableAccount: writable.hasRoles && !writable.writable ? undefined : writable.writable });
    return {
      ok: true,
      serverVersion: ping.serverVersion,
      tableCount: ping.tableCount,
      latencyMs: ping.latencyMs,
      writableAccount: writable.hasRoles && !writable.writable ? null : writable.writable,
      writableEvidence: writable.evidence,
      timeZone: ping.timeZone,
      latestTimestamps,
      warnings,
    };
  } catch (error) {
    const message = describeMysqlError(error);
    console.warn(`[datasources] 测试连接失败 (${info.name}): ${(error as { code?: string })?.code ?? 'unknown'}`);
    markDataSourceStatus(id, { ok: false, error: message });
    return { ok: false, error: message, warnings };
  }
}

async function refreshSchema(id: string): Promise<SchemaRefreshResult> {
  const info = requireSource(id);
  const connector = getConnectorForSource(id);
  const started = Date.now();
  try {
    const previous = loadDictionary(id);
    const focused = Object.keys(previous.tables).filter((name) => previous.tables[name].manual.focused);
    const schema = await connector.fetchSchema({
      sampleValues: info.options.sampleValues !== false,
      sampleTables: focused,
    });
    const valueTables = focused.length
      ? schema.tables.filter((table) => focused.includes(table.name))
      : schema.tables.slice(0, VALUES_TABLES_WITHOUT_FOCUS);
    const values = await connector.fetchValues(valueTables);
    let valueColumns = 0;
    for (const table of schema.tables) {
      for (const column of table.columns) {
        const known = values.values[`${table.name}.${column.name}`];
        if (known && known.length) {
          column.knownValues = known;
          valueColumns += 1;
        }
      }
    }
    const dictionary = saveSkeleton(id, schema.tables);
    markDataSourceStatus(id, { ok: true });
    return {
      tables: Object.keys(dictionary.tables).length,
      columns: Object.values(dictionary.tables).reduce((sum, table) => sum + table.auto.columns.length, 0),
      valueColumns,
      scannedColumns: values.scannedColumns,
      skippedSamples: schema.skippedSamples,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = describeMysqlError(error);
    console.warn(`[datasources] 刷新结构失败 (${info.name}): ${(error as { code?: string })?.code ?? 'unknown'}`);
    markDataSourceStatus(id, { ok: false, error: message });
    throw new Error(message);
  }
}

/** P7 数据源：设置页的增删改查、测试连接、刷新骨架、字典与指标编辑、枚举含义提议。 */
export function registerDataSourcesIpc(): void {
  ipcMain.handle('datasources:list', (): DataSourceInfo[] => listDataSources());

  ipcMain.handle('datasources:create', (_event, raw: unknown): DataSourceInfo => createDataSource(parseCreateInput(raw)));

  ipcMain.handle('datasources:update', async (_event, rawId: unknown, rawPatch: unknown): Promise<DataSourceInfo | null> => {
    const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
    const updated = updateDataSource(id, parseUpdatePatch(rawPatch));
    await invalidateConnector(id);
    return updated;
  });

  ipcMain.handle('datasources:delete', async (_event, rawId: unknown): Promise<boolean> => {
    const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
    const info = getDataSource(id);
    await invalidateConnector(id);
    // P7.5：挂在这个数据源上的定时重跑一并停用并留提示
    const disabled = disableNamedQueryTasksForSource(id, info?.name);
    if (disabled.length) console.info(`[datasources] 已停用 ${disabled.length} 个定时查询任务：${disabled.join('、')}`);
    return deleteDataSource(id);
  });

  ipcMain.handle('datasources:test', (_event, rawId: unknown): Promise<DataSourceTestResult> =>
    testDataSource(requireString(rawId, '数据源 ID', { maxLength: 100 })));

  ipcMain.handle('datasources:refreshSchema', (_event, rawId: unknown): Promise<SchemaRefreshResult> =>
    refreshSchema(requireString(rawId, '数据源 ID', { maxLength: 100 })));

  ipcMain.handle('datasources:getDictionary', (_event, rawId: unknown): DataDictionary =>
    loadDictionary(requireString(rawId, '数据源 ID', { maxLength: 100 })));

  ipcMain.handle('datasources:updateTableManual', (_event, rawId: unknown, rawTable: unknown, rawPatch: unknown): DataDictionary => {
    const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
    const table = requireIdentifier(rawTable, '表名');
    const dictionary = loadDictionary(id);
    if (!dictionary.tables[table]) throw new Error('这张表不在字典里，请先刷新结构');
    return updateTableManual(id, table, parseTableManualPatch(rawPatch));
  });

  ipcMain.handle(
    'datasources:updateColumnManual',
    (_event, rawId: unknown, rawTable: unknown, rawColumn: unknown, rawPatch: unknown): DataDictionary => {
      const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
      const table = requireIdentifier(rawTable, '表名');
      const column = requireIdentifier(rawColumn, '列名');
      const dictionary = loadDictionary(id);
      if (!dictionary.tables[table]?.auto.columns.some((item) => item.name === column)) {
        throw new Error('这一列不在字典里，请先刷新结构');
      }
      return updateColumnManual(id, table, column, parseColumnManualPatch(rawPatch));
    },
  );

  ipcMain.handle('datasources:listMetrics', (_event, rawId: unknown): MetricInfo[] =>
    listMetrics(requireString(rawId, '数据源 ID', { maxLength: 100 })));

  ipcMain.handle('datasources:upsertMetric', (_event, rawId: unknown, rawInput: unknown): MetricInfo => {
    const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
    requireSource(id);
    return upsertMetric({ sourceId: id, ...parseMetricInput(rawInput), source: 'user' });
  });

  ipcMain.handle('datasources:deleteMetric', (_event, rawId: unknown, rawName: unknown): boolean =>
    deleteMetric(requireString(rawId, '数据源 ID', { maxLength: 100 }), requireString(rawName, '指标名', { maxLength: 100 })));

  ipcMain.handle('datasources:proposeEnumMeanings', async (_event, rawId: unknown, rawTable: unknown): Promise<EnumProposalResult> => {
    const id = requireString(rawId, '数据源 ID', { maxLength: 100 });
    const table = requireIdentifier(rawTable, '表名');
    const dictionary = loadDictionary(id);
    const result = await proposeEnumMeanings(dictionary, table);
    return { proposals: result.proposals, candidateCount: result.candidates.length };
  });
}

/** 退出时关掉所有连接池；不等太久，数据库关闭优先 */
export async function shutdownDataSourceConnectors(timeoutMs = 2_000): Promise<void> {
  await Promise.race([
    closeAllConnectors(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
