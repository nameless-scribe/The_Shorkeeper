import type { APIResponse, Page } from 'playwright-core';
import { ERP_REPORT_DAY_LIMIT_MINUTES, ERP_REPORT_MINUTE_STEP, isIsoDate, normalizeErpOrigin } from './contracts';

const MAX_TASKS = 5_000;
const MAX_ENTRY_PAGES = 50;
const PAGE_SIZE = 100;
const ALLOWED_PATHS = new Set(['/getInfo', '/business/task/board', '/business/time-entry/list']);

export interface ErpIdentity {
  userId: string;
  userName: string;
}

export interface ErpTaskSummary {
  taskId: string;
  taskName: string;
  projectName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  actualMinutes: number;
}

export interface ErpTimeEntrySummary {
  timeEntryId: string;
  taskId: string;
  ownerId: string;
  workDate: string;
  workMinutes: number;
  workContent: string;
  createBy: string | null;
}

export interface ErpReadContext {
  identity: ErpIdentity;
  tasks: ErpTaskSummary[];
  entries: ErpTimeEntrySummary[];
  existingMinutes: number;
}

export interface ErpApiTransport {
  get(path: '/getInfo' | '/business/task/board' | '/business/time-entry/list', params?: Record<string, string | number>): Promise<unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, label: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d{1,20}$/.test(String(value))) {
    throw new Error(`${label}无效`);
  }
  return String(value);
}

function nullableId(value: unknown, label: string): string | null {
  return value == null || value === '' ? null : requiredId(value, label);
}

function requiredText(value: unknown, label: string, max = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw new Error(`${label}无效`);
  return value.trim();
}

function nullableText(value: unknown, label: string, max = 2_000): string | null {
  return value == null || value === '' ? null : requiredText(value, label, max);
}

function hoursToMinutes(value: unknown, label: string): number {
  const hours = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  const minutes = hours * 60;
  if (!Number.isFinite(hours) || hours < 0 || !Number.isInteger(minutes) || minutes % ERP_REPORT_MINUTE_STEP !== 0) {
    throw new Error(`${label}无效`);
  }
  return minutes;
}

function assertSuccessEnvelope(value: unknown, label: string): Record<string, unknown> {
  const body = record(value, label);
  if (Number(body.code ?? 200) !== 200) throw new Error(`${label}失败`);
  return body;
}

function parseTask(value: unknown): ErpTaskSummary {
  const task = record(value, 'ERP 任务');
  return {
    taskId: requiredId(task.taskId, 'ERP 任务 ID'),
    taskName: requiredText(task.taskName, 'ERP 任务名称', 200),
    projectName: nullableText(task.projectName, 'ERP 项目名称', 200),
    ownerId: nullableId(task.ownerId, 'ERP 执行人 ID'),
    ownerName: nullableText(task.ownerName, 'ERP 执行人', 200),
    actualMinutes: hoursToMinutes(task.actualHours ?? 0, 'ERP 任务实际工时'),
  };
}

function parseEntry(value: unknown, expectedOwnerId: string, expectedDate: string): ErpTimeEntrySummary {
  const entry = record(value, 'ERP 报工记录');
  const ownerId = requiredId(entry.ownerId, 'ERP 报工用户 ID');
  const workDate = requiredText(entry.workDate, 'ERP 报工日期', 10).slice(0, 10);
  if (ownerId !== expectedOwnerId || workDate !== expectedDate) throw new Error('ERP 返回了其他用户或日期的报工记录');
  return {
    timeEntryId: requiredId(entry.timeEntryId, 'ERP 报工记录 ID'),
    taskId: requiredId(entry.taskId, 'ERP 报工任务 ID'),
    ownerId,
    workDate,
    workMinutes: hoursToMinutes(entry.workHour, 'ERP 报工时长'),
    workContent: typeof entry.workContent === 'string' ? entry.workContent.trim().slice(0, 2_000) : '',
    createBy: nullableText(entry.createBy, 'ERP 上报人', 200),
  };
}

export class ErpReadClient {
  constructor(private readonly transport: ErpApiTransport) {}

  async getIdentity(): Promise<ErpIdentity> {
    const body = assertSuccessEnvelope(await this.transport.get('/getInfo'), 'ERP 身份读取');
    const user = record(body.user, 'ERP 用户');
    return { userId: requiredId(user.userId, 'ERP 用户 ID'), userName: requiredText(user.userName, 'ERP 用户名', 200) };
  }

  async listTasks(ownerId: string): Promise<ErpTaskSummary[]> {
    const normalizedOwnerId = requiredId(ownerId, 'ERP 用户 ID');
    const body = assertSuccessEnvelope(await this.transport.get('/business/task/board', { ownerId: normalizedOwnerId }), 'ERP 任务读取');
    if (!Array.isArray(body.data) || body.data.length > MAX_TASKS) throw new Error('ERP 任务列表不完整或超过安全上限');
    const tasks = body.data.map(parseTask);
    if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) throw new Error('ERP 任务列表包含重复 ID');
    if (tasks.some((task) => task.ownerId !== normalizedOwnerId)) throw new Error('ERP 返回了其他执行人的任务');
    return tasks;
  }

  async listDailyEntries(ownerId: string, workDate: string): Promise<ErpTimeEntrySummary[]> {
    const normalizedOwnerId = requiredId(ownerId, 'ERP 用户 ID');
    if (!isIsoDate(workDate)) throw new Error('ERP 报工日期无效');
    const entries = new Map<string, ErpTimeEntrySummary>();
    let expectedTotal: number | null = null;
    for (let pageNum = 1; pageNum <= MAX_ENTRY_PAGES; pageNum += 1) {
      const body = assertSuccessEnvelope(await this.transport.get('/business/time-entry/list', {
        pageNum, pageSize: PAGE_SIZE, ownerId: normalizedOwnerId, workDate,
      }), 'ERP 报工读取');
      if (!Array.isArray(body.rows)) throw new Error('ERP 报工分页格式无效');
      const total = Number(body.total);
      if (!Number.isInteger(total) || total < 0 || total > MAX_ENTRY_PAGES * PAGE_SIZE) throw new Error('ERP 报工总数无效');
      if (expectedTotal == null) expectedTotal = total;
      else if (expectedTotal !== total) throw new Error('ERP 报工列表在读取过程中发生变化，请重新核对');
      for (const raw of body.rows) {
        const entry = parseEntry(raw, normalizedOwnerId, workDate);
        if (entries.has(entry.timeEntryId)) throw new Error('ERP 报工分页包含重复记录');
        entries.set(entry.timeEntryId, entry);
      }
      if (entries.size === total) return [...entries.values()];
      if (body.rows.length === 0 || entries.size > total) throw new Error('ERP 报工分页不完整');
    }
    throw new Error('ERP 报工分页超过安全上限');
  }

  async readContext(workDate: string): Promise<ErpReadContext> {
    const identity = await this.getIdentity();
    const [tasks, entries] = await Promise.all([
      this.listTasks(identity.userId), this.listDailyEntries(identity.userId, workDate),
    ]);
    const existingMinutes = entries.reduce((total, entry) => total + entry.workMinutes, 0);
    if (existingMinutes > ERP_REPORT_DAY_LIMIT_MINUTES) throw new Error('ERP 当天已有工时超过 8 小时，请先人工核对');
    return { identity, tasks, entries, existingMinutes };
  }
}

async function responseJson(response: APIResponse, origin: string, label: string): Promise<unknown> {
  const responseUrl = new URL(response.url());
  if (responseUrl.origin !== origin) throw new Error(`${label}发生跨站跳转`);
  if (!response.ok()) throw new Error(`${label}返回 HTTP ${response.status()}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}返回的不是 JSON`);
  }
}

export class PlaywrightErpApiTransport implements ErpApiTransport {
  private readonly origin: string;
  private readonly apiPrefix: string;

  constructor(private readonly page: Page, origin: string, apiPrefix = '/prod-api') {
    this.origin = normalizeErpOrigin(origin);
    if (!/^\/[A-Za-z0-9/_-]{0,100}$/.test(apiPrefix) || apiPrefix.includes('..')) throw new Error('ERP API 前缀无效');
    this.apiPrefix = apiPrefix.replace(/\/+$/, '');
  }

  async get(path: '/getInfo' | '/business/task/board' | '/business/time-entry/list', params?: Record<string, string | number>): Promise<unknown> {
    if (!ALLOWED_PATHS.has(path)) throw new Error('不允许访问该 ERP API');
    if (new URL(this.page.url()).origin !== this.origin) throw new Error('ERP 页面已离开已配置站点');
    const cookies = await this.page.context().cookies(this.origin);
    const token = cookies.find((cookie) => cookie.name === 'GTerp-Token')?.value;
    if (!token) throw new Error('ERP 尚未登录，请先在专用浏览器完成登录');
    const label = path === '/getInfo' ? 'ERP 身份读取' : path.includes('time-entry') ? 'ERP 报工读取' : 'ERP 任务读取';
    const response = await this.page.request.get(`${this.origin}${this.apiPrefix}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, params, timeout: 15_000,
    });
    return responseJson(response, this.origin, label);
  }
}
