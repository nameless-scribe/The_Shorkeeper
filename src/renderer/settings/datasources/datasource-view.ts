/**
 * 数据源设置页的纯展示逻辑：状态标签、枚举文本 ↔ 对象、测试结果成行。
 * 不碰 window.shorekeeper，方便单测。
 */
import type { DataSourceInfo, DataSourceTestResult, DictionaryJoin, SchemaRefreshResult, TimeZoneProbe } from '@/shared/types';
import { formatUtcOffset } from '@/datasources/mysql-helpers';

export type StatusTone = 'cyan' | 'green' | 'amber' | 'muted';

export function sourceStatus(info: Pick<DataSourceInfo, 'lastOkAt' | 'lastError' | 'writableAccount'>): { label: string; tone: StatusTone } {
  if (info.lastError) return { label: '连接失败', tone: 'amber' };
  if (info.writableAccount === true) return { label: '已连通 · 账号可写', tone: 'amber' };
  if (info.lastOkAt) return { label: '已连通', tone: 'green' };
  return { label: '未测试', tone: 'muted' };
}

export function formatCheckedAt(timestamp: number | null): string {
  if (!timestamp) return '还没测试过连接';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `上次连通 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "1=待付款"、"1：待付款"、"1 待付款" 每行一条；重复取值后者覆盖 */
export function parseEnumText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(.+?)\s*(?:=|:|：|\t| {2,}| )\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const meaning = match[2].trim();
    if (key && meaning) result[key] = meaning;
  }
  return result;
}

export function formatEnumText(values: Record<string, string> | undefined): string {
  if (!values) return '';
  return Object.entries(values)
    .map(([key, meaning]) => `${key}=${meaning}`)
    .join('\n');
}

export function formatTimeZoneLines(probe: TimeZoneProbe): string[] {
  return [
    probe.summary,
    `服务器现在的时间：${probe.serverNow || '未知'}（UTC 时间 ${probe.serverUtcNow || '未知'}，相差 ${formatUtcOffset(probe.offsetMinutes)}）`,
    `全局时区 ${probe.globalTimeZone || '未知'} · 会话时区 ${probe.sessionTimeZone || '未知'} · 系统时区 ${probe.systemTimeZone || '未知'}`,
  ];
}

export function describeTestResult(result: DataSourceTestResult): string[] {
  if (!result.ok) return [`连接失败：${result.error ?? '原因不明'}`, ...result.warnings];
  const lines = [
    `连接成功：MySQL ${result.serverVersion ?? '?'}，${result.tableCount ?? 0} 张表，耗时 ${result.latencyMs ?? 0} 毫秒。`,
  ];
  if (result.writableAccount === true) lines.push(`账号有写权限（${result.writableEvidence ?? '见授权'}）。`);
  else if (result.writableAccount === false) lines.push('账号是只读的。');
  else lines.push('账号权限探测不出来（通过角色授权）。');
  if (result.timeZone) lines.push(...formatTimeZoneLines(result.timeZone));
  for (const item of result.latestTimestamps ?? []) {
    lines.push(`${item.table}.${item.column} 最新一条：${item.value ?? '（空）'}，请对照本地时间判断库里存的是本地时间还是 UTC。`);
  }
  lines.push(...result.warnings);
  return lines;
}

export function describeRefreshResult(result: SchemaRefreshResult): string {
  const parts = [`已读取 ${result.tables} 张表、${result.columns} 列`];
  if (result.scannedColumns) parts.push(`${result.valueColumns} 列建了取值表（扫了 ${result.scannedColumns} 列）`);
  if (result.skippedSamples) parts.push(`${result.skippedSamples} 张表的样例值没抓到`);
  parts.push(`耗时 ${(result.durationMs / 1000).toFixed(1)} 秒`);
  return `${parts.join('，')}。人工填写的内容都还在。`;
}

export function joinLabel(join: DictionaryJoin): string {
  return `${join.fromTable}.${join.fromColumn} → ${join.toTable}.${join.toColumn}（${join.cardinality}）`;
}

const TIME_TYPES = /^(datetime|timestamp|date)\b/i;

/** 时间基准列的候选：日期时间类型排前面，其余照原顺序 */
export function orderTimeColumnCandidates(columns: Array<{ name: string; type: string }>): Array<{ name: string; type: string; likely: boolean }> {
  const likely = columns.filter((column) => TIME_TYPES.test(column.type)).map((column) => ({ ...column, likely: true }));
  const rest = columns.filter((column) => !TIME_TYPES.test(column.type)).map((column) => ({ ...column, likely: false }));
  return [...likely, ...rest];
}

export function tableMatchesSearch(name: string, businessName: string | undefined, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle) || (businessName ?? '').toLowerCase().includes(needle);
}
