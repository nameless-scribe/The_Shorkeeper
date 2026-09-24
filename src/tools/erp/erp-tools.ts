import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolveErpSettings } from '../../config/erp';
import { createErpReportDraft, findOpenErpReportDraft, getErpReportDraft, updateErpReportDraft } from '../../db/repositories/erp-work-reports';
import { listMessages } from '../../db/repositories/messages';
import { calculateDailyBudget, digestErpPayload, formatMinutes, isIsoDate, parseDraftItems, type ErpReportDraftItem } from '../../erp/contracts';
import { getErpRuntime } from '../../erp/runtime';
import { executeErpSubmission, previewErpSubmission, reconcileErpSubmission, type ErpSubmissionRequest } from '../../erp/submission-service';
import type { ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';

const CONNECT_CONTRACT: ToolSideEffectContract = { risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'manual', evidence: 'output' };
const PREPARE_CONTRACT: ToolSideEffectContract = { risk: 'low', idempotent: false, supportsPreview: false, reversible: 'manual', evidence: 'output' };
const SUBMIT_CONTRACT: ToolSideEffectContract = {
  risk: 'high', idempotent: false, supportsPreview: true, reversible: 'manual', evidence: 'output',
  requiresPersistentApproval: true,
};

function invalid(error: string): ToolResult { return { success: false, output: '', error, errorCategory: 'invalid_arguments' }; }
function failure(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, output: '', error: message, errorCategory: /登录|连接|网络|HTTP/.test(message) ? 'network_failure' : 'internal_error' };
}
function checkEnabled(): ToolResult | null {
  try {
    if (!resolveErpSettings().enabled) return { success: false, output: '', error: 'ERP 报工功能未开启，请先到设置 → ERP 报工启用并配置站点', errorCategory: 'permission_denied' };
    return null;
  } catch (error) { return failure(error); }
}

export const connectErpTool: ToolDefinition = {
  name: 'connect_erp',
  description: '打开或恢复专用 ERP 浏览器。可能需要用户在可见窗口核对验证码并登录；不会新增、修改或删除报工',
  category: 'skill', requiresPermission: ['network', 'automation'], sideEffects: CONNECT_CONTRACT,
  parameters: { type: 'object', properties: {} },
  async execute() {
    const disabled = checkEnabled(); if (disabled) return disabled;
    try {
      const info = await getErpRuntime().connect();
      return { success: true, output: info.message, metadata: { state: info.state, userId: info.userId, userName: info.userName } };
    } catch (error) { return failure(error); }
  },
};

function normalizedQuery(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('query 必须是字符串');
  const query = value.trim();
  if ([...query].length > 200) throw new Error('query 超过 200 字');
  return query;
}

export const readErpContextTool: ToolDefinition = {
  name: 'read_erp_context',
  description: '在已登录的专用 ERP 会话中，读取当前身份、本人指定日期全部报工，以及按名称筛选的本人任务候选；只读，不会自动打开浏览器或写入 ERP',
  category: 'skill', requiresPermission: ['network'], sideEffects: READ_ONLY_CONTRACT,
  parameters: { type: 'object', properties: {
    work_date: { type: 'string', description: '明确日期 YYYY-MM-DD' },
    query: { type: 'string', description: '任务或项目名称线索；任务较多时必须给出' },
  }, required: ['work_date'] },
  async execute(args) {
    const disabled = checkEnabled(); if (disabled) return disabled;
    const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const workDate = typeof input.work_date === 'string' ? input.work_date.trim() : '';
    if (!isIsoDate(workDate)) return invalid('work_date 必须是有效的 YYYY-MM-DD');
    let query: string;
    try { query = normalizedQuery(input.query); } catch (error) { return invalid(error instanceof Error ? error.message : String(error)); }
    try {
      const context = await getErpRuntime().readContext(workDate);
      const needle = query.toLocaleLowerCase('zh-CN');
      const matches = context.tasks.filter((task) => !needle || `${task.taskName} ${task.projectName ?? ''}`.toLocaleLowerCase('zh-CN').includes(needle));
      if (!query && matches.length > 50) return invalid(`本人任务有 ${matches.length} 条，请提供任务或项目名称线索缩小范围`);
      const shown = matches.slice(0, 20);
      const taskLines = shown.length ? shown.map((task) => `- taskId=${task.taskId}｜${task.projectName ?? '未分项目'}｜${task.taskName}｜任务累计 ${formatMinutes(task.actualMinutes)}`) : ['- 没有匹配任务'];
      const entryLines = context.entries.length ? context.entries.map((entry) => `- entryId=${entry.timeEntryId}｜taskId=${entry.taskId}｜${formatMinutes(entry.workMinutes)}｜${entry.workContent || '未填写内容'}`) : ['- 当天尚无报工'];
      return {
        success: true,
        output: [`当前 ERP 身份：${context.identity.userName}（userId=${context.identity.userId}）`, `${workDate} 已报：${formatMinutes(context.existingMinutes)}`, `任务候选（${matches.length} 条，显示 ${shown.length} 条）：`, ...taskLines, '当天报工明细：', ...entryLines].join('\n'),
        metadata: { userId: context.identity.userId, userName: context.identity.userName, workDate, existingMinutes: context.existingMinutes, taskCount: matches.length, shownTaskCount: shown.length, entryCount: context.entries.length },
      };
    } catch (error) { return failure(error); }
  },
};

interface RawDraftItem { item_id?: unknown; task_id?: unknown; task_name?: unknown; project_name?: unknown; work_hours?: unknown; work_content?: unknown; duration_estimated?: unknown }

export function parseToolDraftItems(value: unknown, sourceMessageId: string, previous: ErpReportDraftItem[] = []): ErpReportDraftItem[] {
  if (!Array.isArray(value)) throw new Error('items 必须是数组');
  const previousById = new Map(previous.map((item) => [item.itemId, item]));
  const items = value.map((rawValue) => {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) throw new Error('每条报工必须是对象');
    const raw = rawValue as RawDraftItem;
    const itemId = typeof raw.item_id === 'string' && raw.item_id.trim() ? raw.item_id.trim() : uuidv4();
    const old = previousById.get(itemId);
    const hours = raw.work_hours;
    let workMinutes: number | null = null;
    if (hours != null) {
      if (typeof hours !== 'number' || !Number.isFinite(hours)) throw new Error('work_hours 必须是有限数值');
      workMinutes = hours * 60;
      if (!Number.isInteger(workMinutes)) throw new Error('work_hours 最多保留一位小数');
    }
    const sources = [...new Set([...(old?.sourceMessageIds ?? []), sourceMessageId])];
    if (raw.duration_estimated !== undefined && typeof raw.duration_estimated !== 'boolean') throw new Error('duration_estimated 必须是布尔值');
    const taskId = raw.task_id == null || raw.task_id === '' ? null : String(raw.task_id);
    if (taskId && !/^\d{1,20}$/.test(taskId)) throw new Error('task_id 无效');
    return {
      itemId,
      taskId,
      taskName: typeof raw.task_name === 'string' ? raw.task_name : '',
      projectName: raw.project_name == null || raw.project_name === '' ? null : String(raw.project_name),
      workMinutes,
      workContent: typeof raw.work_content === 'string' ? raw.work_content : '',
      durationEstimated: raw.duration_estimated === true,
      sourceMessageIds: sources,
    };
  });
  return parseDraftItems(items);
}

export const prepareErpReportTool: ToolDefinition = {
  name: 'prepare_erp_report',
  description: '把用户自由描述整理为可继续修改的本地 ERP 报工草稿。只保存草稿，不会打开浏览器或提交 ERP；修改时必须带原 draft_id、expected_revision 和稳定 item_id',
  category: 'skill', requiresPermission: ['network'], sideEffects: PREPARE_CONTRACT,
  parameters: { type: 'object', properties: {
    draft_id: { type: 'string', description: '修改已有草稿时填写' }, expected_revision: { type: 'number', description: '修改已有草稿时填写当前 revision' },
    work_date: { type: 'string', description: '明确日期 YYYY-MM-DD' },
    items: { type: 'array', items: { type: 'object', properties: {
      item_id: { type: 'string' }, task_id: { type: ['string', 'null'] }, task_name: { type: 'string' }, project_name: { type: ['string', 'null'] },
      work_hours: { type: ['number', 'null'], description: '明确的小数小时；未知时 null' }, work_content: { type: 'string' }, duration_estimated: { type: 'boolean' },
    }, required: ['task_name', 'work_hours', 'work_content'] } },
    allow_possible_duplicate: { type: 'boolean', description: '只有用户看过已有同内容记录并明确仍要保留第二条草稿时才设为 true' },
  }, required: ['work_date', 'items'] },
  async execute(args, ctx) {
    const disabled = checkEnabled(); if (disabled) return disabled;
    const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const workDate = typeof input.work_date === 'string' ? input.work_date.trim() : '';
    if (!isIsoDate(workDate)) return invalid('work_date 必须是有效的 YYYY-MM-DD');
    const latestUser = listMessages(ctx.sessionId).filter((message) => message.role === 'user').at(-1);
    if (!latestUser) return invalid('当前会话没有可引用的用户消息');
    try {
      const settings = resolveErpSettings();
      const draftId = typeof input.draft_id === 'string' ? input.draft_id.trim() : '';
      const openDraft = !draftId ? findOpenErpReportDraft(ctx.sessionId, workDate) : null;
      if (openDraft) return invalid(`当前会话和日期已有未完成草稿 draftId=${openDraft.id} revision=${openDraft.revision}；请读取该草稿并按版本修改，不能重复新建`);
      const current = draftId ? getErpReportDraft(draftId) : null;
      if (draftId && (!current || current.sessionId !== ctx.sessionId)) return invalid('未找到当前会话的 ERP 草稿');
      if (current && current.workDate !== workDate) return invalid('不能在原草稿中静默更换报工日期，请新建草稿');
      if (current && current.erpOrigin !== settings.origin) return invalid('ERP 站点已变化，原草稿不能用于当前站点，请新建草稿');
      if (current && (!Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 1)) return invalid('修改草稿必须提供有效的 expected_revision');
      const connection = getErpRuntime().status();
      if (connection.state !== 'authenticated' || connection.origin !== settings.origin) {
        return invalid('ERP 当前连接与配置站点不一致，请重新连接并核对站点');
      }
      const items = parseToolDraftItems(input.items, latestUser.id, current?.items ?? []);
      if (input.allow_possible_duplicate !== undefined && typeof input.allow_possible_duplicate !== 'boolean') return invalid('allow_possible_duplicate 必须是布尔值');
      const remote = await getErpRuntime().readContext(workDate);
      const tasks = new Map(remote.tasks.map((task) => [task.taskId, task]));
      for (const item of items) {
        if (!item.taskId) continue;
        const task = tasks.get(item.taskId);
        if (!task || task.taskName !== item.taskName || (item.projectName && task.projectName !== item.projectName)) {
          return invalid(`任务「${item.taskName}」与 ERP 当前任务不一致，请重新读取候选`);
        }
      }
      const duplicate = items.find((item) => item.taskId && item.workMinutes != null && remote.entries.some((entry) =>
        entry.taskId === item.taskId && entry.workMinutes === item.workMinutes && entry.workContent === item.workContent));
      if (duplicate && input.allow_possible_duplicate !== true) {
        return invalid(`ERP 当天已有一条与「${duplicate.taskName}」工时及内容相同的记录；请先让用户核对，明确仍要新增时再设 allow_possible_duplicate=true`);
      }
      const budget = calculateDailyBudget(remote.existingMinutes, items);
      const draft = current
        ? updateErpReportDraft(current.id, Number(input.expected_revision), { items, erpUserId: remote.identity.userId })
        : createErpReportDraft({
          sessionId: ctx.sessionId,
          connectionKey: createHash('sha256').update(`${settings.origin}:${remote.identity.userId}`).digest('hex'),
          erpOrigin: settings.origin, erpUserId: remote.identity.userId, workDate, items,
        });
      if (!draft) return invalid('草稿版本已变化，请重新读取后再修改');
      const lines = draft.items.map((item) => `- itemId=${item.itemId}｜${item.projectName ?? '项目待匹配'}｜${item.taskName}｜${item.workMinutes == null ? '工时待补充' : formatMinutes(item.workMinutes)}｜${item.workContent}${item.taskId ? `｜taskId=${item.taskId}` : '｜任务待匹配'}${item.durationEstimated ? '｜工时待确认' : ''}`);
      return {
        success: true,
        output: [`ERP 报工草稿 draftId=${draft.id} revision=${draft.revision}（${draft.status === 'ready' ? '结构已就绪，提交前仍需业务预览确认' : '仍有待补充项'}）`, `日期：${draft.workDate}`, ...lines, `当天已报：${formatMinutes(budget.existingMinutes)}｜本批：${formatMinutes(budget.draftMinutes)}｜提交后：${formatMinutes(budget.totalMinutes)}｜剩余：${formatMinutes(budget.remainingMinutes)}`].join('\n'),
        metadata: { draftId: draft.id, revision: draft.revision, status: draft.status, workDate: draft.workDate, existingMinutes: budget.existingMinutes, draftMinutes: budget.draftMinutes, totalMinutes: budget.totalMinutes },
      };
    } catch (error) { return invalid(error instanceof Error ? error.message : String(error)); }
  },
};

export function parseSubmissionRequest(args: unknown): ErpSubmissionRequest {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('提交参数必须是对象');
  const input = args as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => !['draft_id', 'draft_revision', 'batch_id', 'allow_possible_duplicate'].includes(key));
  if (extra.length) throw new Error(`提交参数包含不支持的字段：${extra.join(', ')}`);
  if (input.allow_possible_duplicate !== undefined && typeof input.allow_possible_duplicate !== 'boolean') {
    throw new Error('allow_possible_duplicate 必须是布尔值');
  }
  const allowPossibleDuplicate = input.allow_possible_duplicate === true;
  if (input.batch_id !== undefined) {
    if (input.draft_id !== undefined || input.draft_revision !== undefined) throw new Error('batch_id 不能与草稿参数同时使用');
    const batchId = typeof input.batch_id === 'string' ? input.batch_id.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new Error('batch_id 无效');
    return { batchId, allowPossibleDuplicate };
  }
  const draftId = typeof input.draft_id === 'string' ? input.draft_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) throw new Error('draft_id 无效');
  if (!Number.isInteger(input.draft_revision) || Number(input.draft_revision) < 1) throw new Error('draft_revision 必须是正整数');
  return { draftId, draftRevision: Number(input.draft_revision), allowPossibleDuplicate };
}

export const submitErpReportTool: ToolDefinition = {
  name: 'submit_erp_report',
  description: '预览并提交已就绪的 ERP 报工草稿，或在回查无结果未知后接续已有批次的剩余条目。两种模式都须展示具体报工并取得新的持久化审批；逐条保存后回查记录',
  category: 'skill',
  requiresPermission: ['network', 'automation'],
  sideEffects: SUBMIT_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      draft_id: { type: 'string', description: 'prepare_erp_report 返回的草稿 ID' },
      draft_revision: { type: 'integer', description: '用户最终确认的草稿版本' },
      batch_id: { type: 'string', description: '接续部分完成批次时的批次 ID；与 draft_id/draft_revision 二选一' },
      allow_possible_duplicate: { type: 'boolean', description: '只有用户看过已有相同记录并明确仍要新增时设为 true' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const disabled = checkEnabled(); if (disabled) return disabled;
    let request: ErpSubmissionRequest;
    try { request = parseSubmissionRequest(args); } catch (error) { return invalid(error instanceof Error ? error.message : String(error)); }
    try {
      if (ctx.preview) {
        return { success: true, output: 'ERP 报工预览已生成，尚未写入', preview: await previewErpSubmission(request, ctx.sessionId) };
      }
      if (!ctx.runId || !ctx.stepId || !ctx.callId || !ctx.approvalId || !ctx.approvalArgsDigest || !ctx.previewRevision) {
        return { success: false, output: '', error: '缺少与本次调用绑定的持久化审批，已停止 ERP 提交', errorCategory: 'permission_denied' };
      }
      if (digestErpPayload(args) !== ctx.approvalArgsDigest) {
        return { success: false, output: '', error: '提交参数与获批参数不一致，已停止 ERP 提交', errorCategory: 'permission_denied' };
      }
      const result = await executeErpSubmission(request, {
        sessionId: ctx.sessionId,
        runId: ctx.runId,
        stepId: ctx.stepId,
        callId: ctx.callId,
        approvalId: ctx.approvalId,
        argsDigest: ctx.approvalArgsDigest,
        previewRevision: ctx.previewRevision,
        toolName: 'submit_erp_report',
        signal: ctx.signal,
      });
      return { success: true, output: result.output, metadata: { batchId: result.batchId, verified: result.verified, total: result.total } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: '',
        error: message,
        errorCategory: /结果未知|无法唯一核验|回查失败/.test(message) ? 'outcome_unknown'
          : /取消/.test(message) ? 'cancelled'
            : /审批|获批|预览已失效/.test(message) ? 'permission_denied'
              : /ERP|登录|网络|HTTP/.test(message) ? 'external_service_failure' : 'internal_error',
      };
    }
  },
};

export const reconcileErpReportTool: ToolDefinition = {
  name: 'reconcile_erp_report',
  description: '只读回查一个结果未知的 ERP 报工批次，并补记能够唯一匹配的远程记录；绝不再次点击新增或提交',
  category: 'skill',
  requiresPermission: ['network'],
  sideEffects: { risk: 'low', idempotent: true, supportsPreview: false, reversible: 'none', evidence: 'output' },
  parameters: {
    type: 'object', properties: { batch_id: { type: 'string', description: '结果未知错误中返回的 batchId' } },
    required: ['batch_id'], additionalProperties: false,
  },
  async execute(args, ctx) {
    const disabled = checkEnabled(); if (disabled) return disabled;
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
    const batchId = typeof input.batch_id === 'string' ? input.batch_id.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return invalid('batch_id 无效');
    if (Object.keys(input).some((key) => key !== 'batch_id')) return invalid('回查参数包含不支持的字段');
    try {
      const result = await reconcileErpSubmission(batchId, ctx.sessionId);
      return { success: result.unresolved === 0, output: result.output,
        ...(result.unresolved ? { error: result.output, errorCategory: 'outcome_unknown' as const } : {}),
        metadata: { batchId, recovered: result.recovered, unresolved: result.unresolved, verified: result.verified, total: result.total } };
    } catch (error) { return failure(error); }
  },
};
