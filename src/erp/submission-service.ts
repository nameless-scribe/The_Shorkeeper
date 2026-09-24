import {
  claimErpReportBatch,
  claimErpReportBatchForResume,
  finishErpReportBatch,
  freezeErpReportBatch,
  getErpReportBatch,
  getErpReportDraft,
  interruptErpReportBatch,
  listErpReportSubmissions,
  settleErpReportBatchAfterRecovery,
  startErpSubmission,
  transitionErpSubmission,
  type ErpReportBatchInfo,
  type ErpReportDraftInfo,
} from '../db/repositories/erp-work-reports';
import type { ErpWorkReportPreviewData, ToolPreviewInfo } from '../shared/types';
import { calculateDailyBudget, digestErpPayload, formatMinutes, isIsoDate, parseDraftItems, validateDraftForSubmission, type ErpReportDraftItem } from './contracts';
import type { ErpReadContext, ErpTimeEntrySummary } from './read-client';
import { getErpRuntime } from './runtime';

export type ErpSubmissionRequest = {
  draftId: string;
  draftRevision: number;
  batchId?: never;
  allowPossibleDuplicate: boolean;
} | {
  batchId: string;
  draftId?: never;
  draftRevision?: never;
  allowPossibleDuplicate: boolean;
};

function isResumeRequest(request: ErpSubmissionRequest): request is Extract<ErpSubmissionRequest, { batchId: string }> {
  return typeof request.batchId === 'string';
}

export interface ErpSubmissionAuthorization {
  sessionId: string;
  runId: string;
  stepId: string;
  callId: string;
  approvalId: string;
  argsDigest: string;
  previewRevision: string;
  toolName: string;
  signal: AbortSignal;
}

interface SubmissionSnapshot {
  draft: ErpReportDraftInfo;
  context: ErpReadContext;
  previewRevision: string;
  previewData: ErpWorkReportPreviewData;
}

interface ResumeSnapshot {
  batch: ErpReportBatchInfo;
  workItems: ErpReportDraftItem[];
  totalItems: number;
  verifiedBefore: number;
  origin: string;
  userId: string;
  workDate: string;
  connectionKey: string;
  previewRevision: string;
  previewData: ErpWorkReportPreviewData;
  context: ErpReadContext;
}

function exactDuplicate(context: ErpReadContext, item: ErpReportDraftItem): boolean {
  return context.entries.some((entry) => entry.taskId === item.taskId
    && entry.workMinutes === item.workMinutes
    && entry.workContent === item.workContent);
}

function entryBaselineDigest(entries: ErpTimeEntrySummary[]): string {
  return digestErpPayload(entries.map((entry) => ({
    id: entry.timeEntryId, ownerId: entry.ownerId, workDate: entry.workDate,
    taskId: entry.taskId, workMinutes: entry.workMinutes, workContent: entry.workContent,
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

function assertConnectedOrigin(expectedOrigin: string): void {
  const connection = getErpRuntime().status();
  if (connection.state !== 'authenticated' || connection.origin !== expectedOrigin) {
    throw new Error('ERP 当前登录站点与报工草稿或批次不一致，请重新连接并核对站点');
  }
}

function validateSnapshot(
  request: Extract<ErpSubmissionRequest, { draftId: string }>,
  sessionId: string,
  draft: ErpReportDraftInfo | null,
  context: ErpReadContext,
): SubmissionSnapshot {
  if (!draft || draft.sessionId !== sessionId) throw new Error('未找到当前会话的 ERP 报工草稿');
  if (draft.revision !== request.draftRevision || draft.status !== 'ready') throw new Error('报工草稿已变化或尚未就绪，请重新整理');
  const validation = validateDraftForSubmission(draft.items);
  if (!validation.ready) throw new Error(validation.errors.join('；'));
  if (!draft.erpUserId || context.identity.userId !== draft.erpUserId) throw new Error('ERP 登录身份与草稿不一致');
  const tasks = new Map(context.tasks.map((task) => [task.taskId, task]));
  for (const item of draft.items) {
    const task = item.taskId ? tasks.get(item.taskId) : undefined;
    if (!task || task.taskName !== item.taskName || (item.projectName && task.projectName !== item.projectName)) {
      throw new Error(`ERP 任务「${item.taskName}」已变化，请重新读取并整理草稿`);
    }
    if (!request.allowPossibleDuplicate && exactDuplicate(context, item)) {
      throw new Error(`ERP 当天已有与「${item.taskName}」工时及内容相同的记录，请核对后明确允许重复`);
    }
  }
  const budget = calculateDailyBudget(context.existingMinutes, draft.items);
  const baseline = context.entries
    .map((entry) => ({ id: entry.timeEntryId, taskId: entry.taskId, minutes: entry.workMinutes, content: entry.workContent }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const previewData: ErpWorkReportPreviewData = {
    accountName: `${context.identity.userName}（${context.identity.userId}）`,
    workDate: draft.workDate,
    existingMinutes: budget.existingMinutes,
    batchMinutes: budget.draftMinutes,
    totalMinutes: budget.totalMinutes,
    remainingMinutes: budget.remainingMinutes,
    items: draft.items.map((item) => ({
      itemId: item.itemId,
      projectName: item.projectName,
      taskName: item.taskName,
      workMinutes: item.workMinutes!,
      workContent: item.workContent,
    })),
  };
  return {
    draft,
    context,
    previewData,
    previewRevision: digestErpPayload({
      draftId: draft.id,
      draftRevision: draft.revision,
      origin: draft.erpOrigin,
      userId: draft.erpUserId,
      workDate: draft.workDate,
      items: draft.items,
      allowPossibleDuplicate: request.allowPossibleDuplicate,
      baseline,
    }),
  };
}

async function loadSnapshot(request: Extract<ErpSubmissionRequest, { draftId: string }>, sessionId: string): Promise<SubmissionSnapshot> {
  const draft = getErpReportDraft(request.draftId);
  if (!draft || draft.sessionId !== sessionId) throw new Error('未找到当前会话的 ERP 报工草稿');
  assertConnectedOrigin(draft.erpOrigin);
  const context = await getErpRuntime().readContext(draft.workDate);
  return validateSnapshot(request, sessionId, draft, context);
}

async function loadResumeSnapshot(
  request: Extract<ErpSubmissionRequest, { batchId: string }>, sessionId: string,
): Promise<ResumeSnapshot> {
  const batch = getErpReportBatch(request.batchId);
  if (!batch) throw new Error('未找到 ERP 报工批次');
  const draft = getErpReportDraft(batch.draftId);
  if (!draft || draft.sessionId !== sessionId) throw new Error('ERP 报工批次不属于当前会话');
  if (batch.activeClaimKey || !['partially_verified', 'cancelled', 'failed'].includes(batch.executionStatus)) {
    throw new Error('ERP 报工批次当前不能接续，请先回查或核对状态');
  }
  if (digestErpPayload(batch.payload) !== batch.payloadDigest) throw new Error('ERP 报工批次快照校验失败');
  const { connectionKey, erpOrigin, erpUserId, workDate } = batch.payload;
  if (typeof connectionKey !== 'string' || !connectionKey || typeof erpOrigin !== 'string' || !erpOrigin
      || typeof erpUserId !== 'string' || !erpUserId || typeof workDate !== 'string' || !isIsoDate(workDate)) {
    throw new Error('ERP 报工批次快照已损坏');
  }
  assertConnectedOrigin(erpOrigin);
  const frozenItems = parseDraftItems(batch.payload.items);
  const attempts = listErpReportSubmissions(batch.id);
  if (attempts.some((row) => ['prepared', 'dispatching', 'verifying', 'unknown'].includes(row.state))) {
    throw new Error('ERP 报工批次仍有未解决发送，请先回查，不能继续新增');
  }
  const verified = attempts.filter((row) => row.state === 'verified');
  const verifiedIds = new Set(verified.map((row) => row.itemId));
  const workItems = frozenItems.filter((item) => !verifiedIds.has(item.itemId));
  if (!workItems.length) throw new Error('ERP 报工批次全部条目已核验，无需再次提交');
  const context = await getErpRuntime().readContext(workDate);
  if (context.identity.userId !== erpUserId) throw new Error('ERP 登录身份与报工批次不一致');
  const frozenById = new Map(frozenItems.map((item) => [item.itemId, item]));
  for (const row of verified) {
    const item = frozenById.get(row.itemId);
    const remote = context.entries.find((entry) => entry.timeEntryId === row.remoteTimeEntryId);
    if (!item || !remote || remote.taskId !== item.taskId || remote.workMinutes !== item.workMinutes
        || remote.workContent !== item.workContent) {
      throw new Error('ERP 已核验记录与批次快照不一致，请先人工核对');
    }
  }
  const tasks = new Map(context.tasks.map((task) => [task.taskId, task]));
  for (const item of workItems) {
    const task = item.taskId ? tasks.get(item.taskId) : undefined;
    if (!task || task.taskName !== item.taskName || (item.projectName && task.projectName !== item.projectName)) {
      throw new Error(`ERP 任务「${item.taskName}」已变化，请重新核对`);
    }
    if (!request.allowPossibleDuplicate && exactDuplicate(context, item)) {
      throw new Error(`ERP 当天已有与「${item.taskName}」工时及内容相同的记录，请核对后明确允许重复`);
    }
  }
  const budget = calculateDailyBudget(context.existingMinutes, workItems);
  const baseline = context.entries.map((entry) => ({
    id: entry.timeEntryId, taskId: entry.taskId, minutes: entry.workMinutes, content: entry.workContent,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const previewData: ErpWorkReportPreviewData = {
    accountName: `${context.identity.userName}（${context.identity.userId}）`, workDate,
    existingMinutes: budget.existingMinutes, batchMinutes: budget.draftMinutes,
    totalMinutes: budget.totalMinutes, remainingMinutes: budget.remainingMinutes,
    items: workItems.map((item) => ({
      itemId: item.itemId, projectName: item.projectName, taskName: item.taskName,
      workMinutes: item.workMinutes!, workContent: item.workContent,
    })),
  };
  return {
    batch, workItems, totalItems: frozenItems.length, verifiedBefore: verified.length,
    origin: erpOrigin, userId: erpUserId, workDate, connectionKey, previewData, context,
    previewRevision: digestErpPayload({
      resumeBatchId: batch.id, payloadDigest: batch.payloadDigest, verifiedItemIds: [...verifiedIds].sort(),
      remainingItemIds: workItems.map((item) => item.itemId), allowPossibleDuplicate: request.allowPossibleDuplicate, baseline,
    }),
  };
}

export async function previewErpSubmission(request: ErpSubmissionRequest, sessionId: string): Promise<ToolPreviewInfo> {
  if (isResumeRequest(request)) {
    const snapshot = await loadResumeSnapshot(request, sessionId);
    return {
      kind: 'erp-work-report',
      target: `批次 ${snapshot.batch.id} · 剩余条目`,
      summary: `已核验 ${snapshot.verifiedBefore} 条；本次将新增剩余 ${snapshot.workItems.length} 条，共 ${formatMinutes(snapshot.previewData.batchMinutes)}`,
      revision: snapshot.previewRevision,
      details: [
        `账号：${snapshot.previewData.accountName}`,
        `日期：${snapshot.workDate}`,
        `当天已报 ${formatMinutes(snapshot.previewData.existingMinutes)}，接续后 ${formatMinutes(snapshot.previewData.totalMinutes)}`,
      ],
      erpWorkReport: snapshot.previewData,
    };
  }
  const snapshot = await loadSnapshot(request, sessionId);
  return {
    kind: 'erp-work-report',
    target: `草稿 ${snapshot.draft.id} · revision ${snapshot.draft.revision}`,
    summary: `将向 ERP 新增 ${snapshot.draft.items.length} 条报工，共 ${formatMinutes(snapshot.previewData.batchMinutes)}`,
    revision: snapshot.previewRevision,
    details: [
      `账号：${snapshot.previewData.accountName}`,
      `日期：${snapshot.draft.workDate}`,
      `当天已报 ${formatMinutes(snapshot.previewData.existingMinutes)}，提交后 ${formatMinutes(snapshot.previewData.totalMinutes)}`,
    ],
    erpWorkReport: snapshot.previewData,
  };
}

function matchingNewEntries(context: ErpReadContext, beforeIds: Set<string>, item: ErpReportDraftItem) {
  return context.entries.filter((entry) => !beforeIds.has(entry.timeEntryId)
    && entry.taskId === item.taskId
    && entry.workMinutes === item.workMinutes
    && entry.workContent === item.workContent);
}

export async function executeErpSubmission(
  request: ErpSubmissionRequest,
  authorization: ErpSubmissionAuthorization,
): Promise<{ batchId: string; verified: number; total: number; output: string }> {
  let batch: ErpReportBatchInfo;
  let claimKey: string;
  let workItems: ErpReportDraftItem[];
  let totalItems: number;
  let verifiedBefore: number;
  let origin: string;
  let userId: string;
  let workDate: string;
  let previewData: ErpWorkReportPreviewData;
  let expectedEntries: ErpTimeEntrySummary[];
  if (isResumeRequest(request)) {
    const snapshot = await loadResumeSnapshot(request, authorization.sessionId);
    if (snapshot.previewRevision !== authorization.previewRevision) {
      throw new Error('ERP 数据或批次在确认后发生变化，旧预览已失效，请重新确认');
    }
    batch = snapshot.batch;
    claimKey = `${snapshot.connectionKey}|${snapshot.userId}|${snapshot.workDate}`;
    if (!claimErpReportBatchForResume(batch.id, claimKey, authorization)) {
      throw new Error('ERP 报工批次接续已被占用或仍有结果未知，请先回查');
    }
    workItems = snapshot.workItems;
    totalItems = snapshot.totalItems;
    verifiedBefore = snapshot.verifiedBefore;
    origin = snapshot.origin;
    userId = snapshot.userId;
    workDate = snapshot.workDate;
    previewData = snapshot.previewData;
    expectedEntries = [...snapshot.context.entries];
  } else {
    const snapshot = await loadSnapshot(request, authorization.sessionId);
    if (snapshot.previewRevision !== authorization.previewRevision) {
      throw new Error('ERP 数据或草稿在确认后发生变化，旧预览已失效，请重新确认');
    }
    batch = freezeErpReportBatch({
      draftId: snapshot.draft.id,
      draftRevision: snapshot.draft.revision,
      previewRevision: authorization.previewRevision,
      approvalId: authorization.approvalId,
      authorizedRunId: authorization.runId,
      authorization: {
        sessionId: authorization.sessionId,
        callId: authorization.callId,
        argsDigest: authorization.argsDigest,
        toolName: authorization.toolName,
      },
    });
    claimKey = `${snapshot.draft.connectionKey}|${snapshot.draft.erpUserId}|${snapshot.draft.workDate}`;
    if (!claimErpReportBatch(batch.id, claimKey, authorization.runId)) {
      throw new Error('同一 ERP 账号和日期已有报工正在执行或结果未知，请先回查');
    }
    workItems = snapshot.draft.items;
    totalItems = workItems.length;
    verifiedBefore = 0;
    origin = snapshot.draft.erpOrigin;
    userId = snapshot.draft.erpUserId!;
    workDate = snapshot.draft.workDate;
    previewData = snapshot.previewData;
    expectedEntries = [...snapshot.context.entries];
  }

  try {
    let verified = verifiedBefore;
    for (let index = 0; index < workItems.length; index += 1) {
      const item = workItems[index];
      const current = await getErpRuntime().readContext(workDate);
      if (current.identity.userId !== userId) {
        finishErpReportBatch(batch.id, claimKey, verified ? 'partially_verified' : 'failed');
        throw new Error('ERP 登录身份在提交过程中发生变化');
      }
      if (entryBaselineDigest(current.entries) !== entryBaselineDigest(expectedEntries)) {
        finishErpReportBatch(batch.id, claimKey, verified ? 'partially_verified' : 'failed');
        throw new Error('ERP 当天报工记录在确认后发生变化，请重新核对并确认');
      }
      calculateDailyBudget(current.existingMinutes, workItems.slice(index));
      if (!request.allowPossibleDuplicate && exactDuplicate(current, item)) {
        finishErpReportBatch(batch.id, claimKey, verified ? 'partially_verified' : 'failed');
        throw new Error(`ERP 已出现与「${item.taskName}」相同的记录，已停止后续提交`);
      }
      const beforeIds = current.entries.map((entry) => entry.timeEntryId);
      const submission = startErpSubmission({
        logicalOperationId: `${batch.id}:${item.itemId}`,
        batchId: batch.id,
        itemId: item.itemId,
        runId: authorization.runId,
        stepId: authorization.stepId,
        callId: authorization.callId,
        approvalId: authorization.approvalId,
        request: item,
        beforeEntryIds: beforeIds,
      });
      if (submission.state === 'verified') { verified += 1; continue; }
      if (submission.state !== 'prepared') {
        finishErpReportBatch(batch.id, claimKey, 'unknown');
        throw new Error(`报工「${item.taskName}」存在未解决的历史发送，已停止以避免重复`);
      }
      if (authorization.signal.aborted) {
        transitionErpSubmission(submission.id, 'prepared', 'cancelled', { errorCode: 'cancelled_before_dispatch' });
        finishErpReportBatch(batch.id, claimKey, verified ? 'partially_verified' : 'cancelled');
        throw new Error('ERP 报工已取消，尚未点击提交');
      }
      if (!transitionErpSubmission(submission.id, 'prepared', 'dispatching')) {
        throw new Error('ERP 发送账本未能可靠记录，已停止提交');
      }
      const dispatch = await getErpRuntime().submitTimeEntry({
        origin,
        taskId: item.taskId!,
        taskName: item.taskName,
        workDate,
        workMinutes: item.workMinutes!,
        workContent: item.workContent,
      }, authorization.signal);
      if (dispatch.status === 'known_not_written') {
        transitionErpSubmission(submission.id, 'dispatching', 'known_not_written', { errorCode: dispatch.message ?? 'not_written' });
        finishErpReportBatch(batch.id, claimKey, verified ? 'partially_verified' : 'failed');
        throw new Error(dispatch.message ?? 'ERP 未写入本条报工');
      }
      if (dispatch.status === 'outcome_unknown') {
        transitionErpSubmission(submission.id, 'dispatching', 'unknown', { errorCode: dispatch.message ?? 'dispatch_unknown' });
        finishErpReportBatch(batch.id, claimKey, 'unknown');
        throw new Error(`${dispatch.message ?? 'ERP 响应不确定'}；批次 batchId=${batch.id} 当前结果未知，请先核对 ERP，暂勿重试`);
      }
      if (!transitionErpSubmission(submission.id, 'dispatching', 'verifying')) {
        throw new Error('ERP 提交后核验账本未能可靠记录');
      }
      let after: ErpReadContext;
      try {
        after = await getErpRuntime().readContext(workDate);
      } catch (error) {
        transitionErpSubmission(submission.id, 'verifying', 'unknown', { errorCode: 'verification_unavailable' });
        finishErpReportBatch(batch.id, claimKey, 'unknown');
        throw new Error(`ERP 已接收提交，但批次 batchId=${batch.id} 回查失败，当前结果未知：${error instanceof Error ? error.message : String(error)}`);
      }
      const matches = matchingNewEntries(after, new Set(beforeIds), item);
      if (matches.length !== 1) {
        transitionErpSubmission(submission.id, 'verifying', 'unknown', {
          errorCode: matches.length ? 'multiple_matches' : 'not_visible_after_submit',
          evidence: { beforeEntryIds: beforeIds, afterEntryIds: after.entries.map((entry) => entry.timeEntryId), matchCount: matches.length },
        });
        finishErpReportBatch(batch.id, claimKey, 'unknown');
        throw new Error(`报工「${item.taskName}」保存后的记录无法唯一核验；批次 batchId=${batch.id} 当前结果未知，请先人工核对`);
      }
      const verifiedSubmission = transitionErpSubmission(submission.id, 'verifying', 'verified', {
        remoteTimeEntryId: matches[0].timeEntryId,
        evidence: { beforeEntryIds: beforeIds, remoteEntry: matches[0] },
      });
      if (!verifiedSubmission) throw new Error('ERP 记录已回查，但本地核验账本未能可靠记录，请勿重复提交');
      expectedEntries.push(matches[0]);
      verified += 1;
    }

    if (!finishErpReportBatch(batch.id, claimKey, 'verified')) throw new Error('报工已核验，但本地批次状态收口失败，请勿重复提交');
    return {
      batchId: batch.id,
      verified,
      total: totalItems,
      output: `ERP 报工已完成并回查核验：${verified}/${totalItems} 条，本次新增 ${formatMinutes(previewData.batchMinutes)}。`,
    };
  } catch (error) {
    const interrupted = interruptErpReportBatch(batch.id, claimKey);
    if (interrupted && getErpReportBatch(batch.id)?.executionStatus === 'unknown') {
      throw new Error(`ERP 报工批次 ${batch.id} 发送中断，结果未知；请先回查，暂勿重试`);
    }
    throw error;
  }
}

export async function reconcileErpSubmission(batchId: string, sessionId: string): Promise<{
  batchId: string;
  recovered: number;
  unresolved: number;
  verified: number;
  total: number;
  output: string;
}> {
  const batch = getErpReportBatch(batchId);
  if (!batch) throw new Error('未找到 ERP 报工批次');
  const draft = getErpReportDraft(batch.draftId);
  if (!draft || draft.sessionId !== sessionId) throw new Error('ERP 报工批次不属于当前会话');
  if (batch.activeClaimKey) throw new Error('ERP 报工批次仍在执行，暂不能恢复核验');
  if (digestErpPayload(batch.payload) !== batch.payloadDigest) throw new Error('ERP 报工批次快照校验失败');
  const frozenUserId = batch.payload.erpUserId;
  const frozenDate = batch.payload.workDate;
  if (typeof frozenUserId !== 'string' || !frozenUserId
      || typeof frozenDate !== 'string' || !isIsoDate(frozenDate)) throw new Error('ERP 报工批次快照已损坏');
  if (typeof batch.payload.erpOrigin !== 'string') throw new Error('ERP 报工批次站点无效');
  assertConnectedOrigin(batch.payload.erpOrigin);
  const frozenItems = parseDraftItems(batch.payload.items);
  const items = new Map(frozenItems.map((item) => [item.itemId, item]));
  const before = listErpReportSubmissions(batch.id);
  if (!before.length) throw new Error('ERP 报工批次没有发送记录');
  const context = await getErpRuntime().readContext(frozenDate);
  if (context.identity.userId !== frozenUserId) throw new Error('ERP 登录身份与报工批次不一致');
  let recovered = 0;
  for (const submission of before.filter((row) => row.state === 'unknown')) {
    const item = items.get(submission.itemId);
    if (!item) throw new Error('ERP 报工批次条目已损坏');
    const matches = matchingNewEntries(context, new Set(submission.beforeEntryIds), item);
    if (matches.length !== 1) continue;
    const updated = transitionErpSubmission(submission.id, 'unknown', 'verified', {
      remoteTimeEntryId: matches[0].timeEntryId,
      evidence: { recovered: true, beforeEntryIds: submission.beforeEntryIds, remoteEntry: matches[0] },
    });
    if (updated) recovered += 1;
  }
  const after = listErpReportSubmissions(batch.id);
  const verifiedItems = new Set(after.filter((row) => row.state === 'verified').map((row) => row.itemId));
  const unresolved = after.filter((row) => row.state === 'unknown').length;
  const allVerified = frozenItems.every((item) => verifiedItems.has(item.itemId));
  settleErpReportBatchAfterRecovery(batch.id, allVerified ? 'verified' : verifiedItems.size ? 'partially_verified' : 'unknown');
  return {
    batchId: batch.id,
    recovered,
    unresolved,
    verified: verifiedItems.size,
    total: frozenItems.length,
    output: allVerified
      ? `ERP 报工批次 ${batch.id} 已回查核验完成：${verifiedItems.size}/${frozenItems.length} 条。`
      : unresolved
        ? `ERP 报工批次 ${batch.id} 回查后仍有 ${unresolved} 条结果未知；没有唯一证据证明未写入，不能自动重试。`
        : `ERP 报工批次 ${batch.id} 已核验 ${verifiedItems.size}/${frozenItems.length} 条，剩余条目可在用户重新确认后用 batch_id 接续。`,
  };
}
