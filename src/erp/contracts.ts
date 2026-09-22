import { createHash } from 'node:crypto';

export const ERP_REPORT_MAX_ITEMS = 16;
export const ERP_REPORT_MAX_CONTENT_CHARS = 2_000;
export const ERP_REPORT_MAX_NAME_CHARS = 200;
export const ERP_REPORT_MAX_SOURCE_REFS = 32;
export const ERP_REPORT_MAX_JSON_BYTES = 64 * 1024;
export const ERP_REPORT_DAY_LIMIT_MINUTES = 8 * 60;
export const ERP_REPORT_MIN_ITEM_MINUTES = 30;
export const ERP_REPORT_MINUTE_STEP = 6; // ERP 页面 precision=1，即 0.1 小时。

export type ErpReportDraftStatus = 'draft' | 'ready' | 'submitted' | 'cancelled';
export type ErpReportBatchStatus =
  | 'approved'
  | 'running'
  | 'partially_verified'
  | 'verified'
  | 'cancelled'
  | 'failed'
  | 'unknown';
export type ErpReportSubmissionState =
  | 'prepared'
  | 'dispatching'
  | 'verifying'
  | 'unknown'
  | 'verified'
  | 'known_not_written'
  | 'cancelled';

export interface ErpReportDraftItem {
  itemId: string;
  taskId: string | null;
  taskName: string;
  projectName: string | null;
  workMinutes: number | null;
  workContent: string;
  durationEstimated: boolean;
  sourceMessageIds: string[];
}

export interface ErpReportDraftPayload {
  items: ErpReportDraftItem[];
}

export interface ErpReportDraftInput {
  sessionId: string;
  connectionKey: string;
  erpOrigin: string;
  erpUserId?: string | null;
  workDate: string;
  items: ErpReportDraftItem[];
  sourceMessageIds?: string[];
}

export interface ErpDailyBudget {
  existingMinutes: number;
  draftMinutes: number;
  totalMinutes: number;
  remainingMinutes: number;
}

export interface ErpDraftValidationResult {
  ready: boolean;
  errors: string[];
  draftMinutes: number;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeErpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('ERP 地址无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('ERP 地址只支持 http 或 https');
  if (url.username || url.password || url.search || url.hash) throw new Error('ERP 地址不能包含凭据、查询参数或片段');
  return url.origin;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`);
  const result = value.trim();
  if (!allowEmpty && !result) throw new Error(`${label}不能为空`);
  if ([...result].length > max) throw new Error(`${label}超过 ${max} 字`);
  return result;
}

function nullableText(value: unknown, label: string, max: number): string | null {
  if (value == null || value === '') return null;
  return text(value, label, max);
}

function parseSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('来源消息必须是数组');
  if (value.length > ERP_REPORT_MAX_SOURCE_REFS) throw new Error(`来源消息最多 ${ERP_REPORT_MAX_SOURCE_REFS} 条`);
  const ids = value.map((item) => text(item, '来源消息 ID', 100));
  if (new Set(ids).size !== ids.length) throw new Error('来源消息 ID 不能重复');
  return ids;
}

export function parseDraftItem(value: unknown): ErpReportDraftItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('报工条目必须是对象');
  const input = value as Record<string, unknown>;
  const rawMinutes = input.workMinutes;
  let workMinutes: number | null = null;
  if (rawMinutes != null) {
    if (!Number.isInteger(rawMinutes)) throw new Error('工时必须换算成整数分钟');
    workMinutes = Number(rawMinutes);
    if (workMinutes < ERP_REPORT_MIN_ITEM_MINUTES) throw new Error('单条工时不能少于 0.5 小时');
    if (workMinutes % ERP_REPORT_MINUTE_STEP !== 0) throw new Error('工时最多保留一位小时小数');
    if (workMinutes > ERP_REPORT_DAY_LIMIT_MINUTES) throw new Error('单条工时不能超过 8 小时');
  }
  return {
    itemId: text(input.itemId, '条目标识', 100),
    taskId: nullableText(input.taskId, '任务 ID', 100),
    taskName: text(input.taskName, '任务名称', ERP_REPORT_MAX_NAME_CHARS),
    projectName: nullableText(input.projectName, '项目名称', ERP_REPORT_MAX_NAME_CHARS),
    workMinutes,
    workContent: text(input.workContent, '工作内容', ERP_REPORT_MAX_CONTENT_CHARS),
    durationEstimated: input.durationEstimated === true,
    sourceMessageIds: parseSourceIds(input.sourceMessageIds ?? []),
  };
}

export function parseDraftItems(value: unknown): ErpReportDraftItem[] {
  if (!Array.isArray(value)) throw new Error('报工条目必须是数组');
  if (!value.length || value.length > ERP_REPORT_MAX_ITEMS) throw new Error(`报工条目数量须为 1–${ERP_REPORT_MAX_ITEMS}`);
  const items = value.map(parseDraftItem);
  const ids = items.map((item) => item.itemId);
  if (new Set(ids).size !== ids.length) throw new Error('条目标识不能重复');
  const jsonBytes = Buffer.byteLength(JSON.stringify({ items }), 'utf8');
  if (jsonBytes > ERP_REPORT_MAX_JSON_BYTES) throw new Error(`报工草稿超过 ${ERP_REPORT_MAX_JSON_BYTES} 字节`);
  return items;
}

export function validateDraftForSubmission(items: ErpReportDraftItem[]): ErpDraftValidationResult {
  const errors: string[] = [];
  let draftMinutes = 0;
  for (const item of items) {
    if (!item.taskId) errors.push(`任务「${item.taskName}」尚未唯一匹配`);
    if (item.workMinutes == null) errors.push(`任务「${item.taskName}」缺少明确工时`);
    else draftMinutes += item.workMinutes;
    if (item.durationEstimated) errors.push(`任务「${item.taskName}」的工时仍是估计值`);
  }
  if (draftMinutes > ERP_REPORT_DAY_LIMIT_MINUTES) errors.push('本批工时超过 8 小时');
  return { ready: errors.length === 0, errors, draftMinutes };
}

export function calculateDailyBudget(existingMinutes: number, items: ErpReportDraftItem[]): ErpDailyBudget {
  if (!Number.isInteger(existingMinutes) || existingMinutes < 0) throw new Error('当天已报工时无效');
  const validation = validateDraftForSubmission(items);
  const totalMinutes = existingMinutes + validation.draftMinutes;
  if (totalMinutes > ERP_REPORT_DAY_LIMIT_MINUTES) {
    throw new Error(`当天合计 ${formatMinutes(totalMinutes)}，超过 8 小时上限`);
  }
  return {
    existingMinutes,
    draftMinutes: validation.draftMinutes,
    totalMinutes,
    remainingMinutes: ERP_REPORT_DAY_LIMIT_MINUTES - totalMinutes,
  };
}

export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('分钟数无效');
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} 小时`;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function digestErpPayload(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

