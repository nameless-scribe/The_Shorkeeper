/**
 * P7.1 连接层的纯函数部分：主机分类、权限判断、取值表候选、时区探测解释、information_schema → 骨架。
 * 不引 mysql2，可以在渲染层与测试里直接用。
 */
import type { ColumnSkeleton, TableSkeleton } from './dictionary';

/** 取值表的行数上限（§11.3）：超过就不对该表跑 GROUP BY */
export const VALUES_MAX_TABLE_ROWS = 5_000_000;
/** 取值表最多存 200 个；第 201 个出现即标高基数 */
export const VALUES_LIMIT = 200;
/** char / varchar 超过这个长度不当枚举列 */
export const VALUES_MAX_TEXT_LENGTH = 64;
/** 每列取值查询的超时 */
export const VALUES_TIMEOUT_MS = 2_000;
/** 每张表抓样例值时读的行数 */
export const SAMPLE_SCAN_ROWS = 20;
export const SAMPLE_TIMEOUT_MS = 2_000;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /\.(local|lan|internal|home|corp)$/i,
];

/** 内网地址、回环地址或不带点的主机名（多半是内网机器名）算私网 */
export function isPrivateHost(host: string): boolean {
  const value = host.trim().replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return !value.includes('.') && !value.includes(':');
}

/** §10：主机不是私网而 SSL 又关着时给一句提醒，不阻止连接 */
export function sslWarning(host: string, ssl: boolean): string | null {
  if (ssl || isPrivateHost(host)) return null;
  return '这个地址看起来是公网地址，SSL 没有打开，密码和查询结果会明文经过网络。';
}

const IDENTIFIER = /^(?![0-9]+$)[\p{L}\p{N}_$]{1,64}$/u;

export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`不合法的标识符：${name}`);
  return '`' + name + '`';
}

/** 数据库名可以含连字符、点等（如 my-db）：反引号本身不允许，其余字符反引号包裹即安全 */
export function quoteDatabaseName(name: string): string {
  if (!name || name.length > 64 || /[\u0000-\u001f`]/.test(name) || /^\s|\s$/.test(name)) throw new Error(`不合法的数据库名：${name}`);
  return '`' + name.replace(/`/g, '``') + '`';
}

const WRITE_PRIVILEGES = [
  'ALL PRIVILEGES',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE TEMPORARY TABLES',
  'LOCK TABLES',
  'EXECUTE',
  'FILE',
  'SUPER',
  'RELOAD',
  'SHUTDOWN',
  'GRANT OPTION',
];

export interface WritableProbe {
  writable: boolean;
  /** 触发判断的那条 GRANT（只在 writable 时有）；不含密码 */
  evidence: string | null;
  /** 账号被授予了角色，角色里的权限这里看不到 */
  hasRoles: boolean;
}

/** 解析 SHOW GRANTS 的输出：出现任何写类权限即判定"有写权限"。只看 GRANT，不做任何写尝试。 */
export function grantsAllowWrite(grants: string[]): WritableProbe {
  let hasRoles = false;
  for (const raw of grants) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const upper = line.toUpperCase();
    if (!upper.startsWith('GRANT ')) continue;
    // 角色授予：GRANT `role`@`%` TO `user`@`%`，没有 ON 子句
    if (!/ ON /.test(upper)) {
      if (/ TO /.test(upper) && !upper.startsWith('GRANT PROXY')) hasRoles = true;
      continue;
    }
    const privileges = upper.slice('GRANT '.length, upper.indexOf(' ON '));
    const items = privileges.split(',').map((item) => item.trim().replace(/\s*\(.*\)$/, ''));
    if (items.some((item) => WRITE_PRIVILEGES.includes(item))) {
      return { writable: true, evidence: stripIdentifiedBy(line), hasRoles };
    }
  }
  return { writable: false, evidence: null, hasRoles };
}

/** 老版本 SHOW GRANTS 会带 IDENTIFIED BY PASSWORD '...'；一律去掉 */
function stripIdentifiedBy(line: string): string {
  return line.replace(/\s+IDENTIFIED BY .*$/i, '');
}

export interface TimeZoneProbe {
  globalTimeZone: string;
  sessionTimeZone: string;
  systemTimeZone: string;
  serverNow: string;
  serverUtcNow: string;
  /** NOW() 减 UTC_TIMESTAMP()，分钟 */
  offsetMinutes: number;
  /** 一句话，设置页原样展示 */
  summary: string;
}

export interface TimeZoneProbeRow {
  global_tz: unknown;
  session_tz: unknown;
  system_tz: unknown;
  server_now: unknown;
  server_utc_now: unknown;
  offset_minutes: unknown;
}

function asText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  return String(value);
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function describeTimeZoneProbe(row: TimeZoneProbeRow): TimeZoneProbe {
  const offsetMinutes = Number(row.offset_minutes ?? 0) || 0;
  const offsetText = formatUtcOffset(offsetMinutes);
  const session = asText(row.session_tz);
  const system = asText(row.system_tz);
  const summary =
    session.toUpperCase() === 'SYSTEM'
      ? `数据库按服务器系统时区（${system || '未知'}）解释时间，当前相当于 ${offsetText}。`
      : `数据库会话时区是 ${session}，当前相当于 ${offsetText}；服务器系统时区是 ${system || '未知'}。`;
  return {
    globalTimeZone: asText(row.global_tz),
    sessionTimeZone: session,
    systemTimeZone: system,
    serverNow: asText(row.server_now),
    serverUtcNow: asText(row.server_utc_now),
    offsetMinutes,
    summary,
  };
}

/** §11.3 + 3.13.4：enum、短文本、以及 tinyint / smallint 这类状态码列才建取值表 */
export function shouldFetchValues(column: Pick<ColumnSkeleton, 'type' | 'primaryKey'>, rowCountEstimate?: number): boolean {
  if (column.primaryKey) return false;
  if (typeof rowCountEstimate === 'number' && rowCountEstimate > VALUES_MAX_TABLE_ROWS) return false;
  const type = column.type.trim().toLowerCase();
  if (type.startsWith('enum(') || type.startsWith('set(')) return true;
  if (/^(tinyint|smallint)\b/.test(type)) return true;
  const text = /^(var)?char\((\d+)\)/.exec(type);
  if (text) return Number(text[2]) <= VALUES_MAX_TEXT_LENGTH;
  return false;
}

export interface TableInfoRow {
  TABLE_NAME: string;
  TABLE_ROWS: number | string | null;
  TABLE_COMMENT: string | null;
  TABLE_TYPE?: string | null;
}

export interface ColumnInfoRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_KEY: string | null;
  COLUMN_COMMENT: string | null;
}

export interface KeyUsageRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_COLUMN_NAME: string | null;
}

/** information_schema 三张表 → 骨架（不含样例值与取值表，那两样另抓） */
export function skeletonFromInformationSchema(
  tables: TableInfoRow[],
  columns: ColumnInfoRow[],
  keys: KeyUsageRow[],
): TableSkeleton[] {
  const byTable = new Map<string, TableSkeleton>();
  for (const table of tables) {
    const rows = table.TABLE_ROWS == null ? undefined : Number(table.TABLE_ROWS);
    byTable.set(table.TABLE_NAME, {
      name: table.TABLE_NAME,
      columns: [],
      foreignKeys: [],
      ...(rows !== undefined && Number.isFinite(rows) ? { rowCountEstimate: rows } : {}),
      ...(table.TABLE_COMMENT?.trim() ? { comment: table.TABLE_COMMENT.trim() } : {}),
    });
  }
  for (const column of columns) {
    const table = byTable.get(column.TABLE_NAME);
    if (!table) continue;
    table.columns.push({
      name: column.COLUMN_NAME,
      type: column.COLUMN_TYPE,
      nullable: column.IS_NULLABLE?.toUpperCase() === 'YES',
      primaryKey: column.COLUMN_KEY?.toUpperCase() === 'PRI',
      samples: [],
      ...(column.COLUMN_COMMENT?.trim() ? { comment: column.COLUMN_COMMENT.trim() } : {}),
    });
  }
  for (const key of keys) {
    if (!key.REFERENCED_TABLE_NAME || !key.REFERENCED_COLUMN_NAME) continue;
    const table = byTable.get(key.TABLE_NAME);
    if (!table) continue;
    if (table.foreignKeys.some((fk) => fk.column === key.COLUMN_NAME && fk.refTable === key.REFERENCED_TABLE_NAME)) continue;
    table.foreignKeys.push({ column: key.COLUMN_NAME, refTable: key.REFERENCED_TABLE_NAME, refColumn: key.REFERENCED_COLUMN_NAME });
  }
  return [...byTable.values()];
}

/** 单元格 → 样例文本；二进制与对象不进字典 */
export function formatCellValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return null;
  if (value instanceof Uint8Array) return null;
  if (value instanceof Date) return asText(value);
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** 每列前 3 个非空样例值（截断交给 mergeSkeleton） */
export function samplesFromRows(rows: Array<Record<string, unknown>>, columns: string[], max = 3): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const column of columns) {
    const samples: string[] = [];
    for (const row of rows) {
      const text = formatCellValue(row[column]);
      if (text && !samples.includes(text)) samples.push(text);
      if (samples.length >= max) break;
    }
    result[column] = samples;
  }
  return result;
}

/** 数据库错误 → 给用户看的一句话；原文只进日志 */
export function describeMysqlError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return '用户名或密码不对，或者这个账号没有访问该数据库的权限。';
    case 'ER_BAD_DB_ERROR':
      return '数据库名不存在，请核对。';
    case 'ECONNREFUSED':
      return '连不上这个地址和端口：服务没在监听，或者端口填错了。';
    case 'ETIMEDOUT':
    case 'PROTOCOL_CONNECTION_LOST':
      return '连接超时：网络不通，或者防火墙拦住了。';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '主机名解析不了，请核对地址。';
    case 'HANDSHAKE_NO_SSL_SUPPORT':
      return '服务器不支持 SSL，请关掉 SSL 开关再试。';
    case 'ER_QUERY_TIMEOUT':
    case 'ER_QUERY_INTERRUPTED':
      return '查询超过时间上限，已中止。';
    default:
      return message.length > 160 ? `${message.slice(0, 160)}…` : message;
  }
}
