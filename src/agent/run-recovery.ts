import { isDatabaseReady } from '../db/state';
import {
  acknowledgeInterruptedRunsForSession,
  findUnacknowledgedInterruptedRun,
  listRunArtifacts,
  listTaskRunSteps,
  markInterruptedRuns,
  type InterruptedRunSummary,
} from '../db/repositories/task-runs';
import type { ArtifactInfo, TaskRunInfo, TaskRunStepInfo } from '../shared/types';
import { findInterruptedQuestion } from '../db/repositories/user-questions';

/**
 * 应用启动时调用一次：进程内此时没有任何活动 run，所有仍处于非终态的记录
 * 都来自上一次进程，一律收口为 interrupted，避免 "已完成" 状态来自猜测。
 */
export function reconcileInterruptedRuns(): InterruptedRunSummary {
  const summary = markInterruptedRuns();
  if (summary.runIds.length) {
    console.info(
      `[run-recovery] 已将 ${summary.runIds.length} 个上次未收口的 run 标记为中断（步骤 ${summary.steps}，审批 ${summary.approvals}，问题 ${summary.questions}）`,
    );
  }
  return summary;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface InterruptedRunNoticeInput {
  run: TaskRunInfo;
  steps: TaskRunStepInfo[];
  artifacts: ArtifactInfo[];
  /** P6.2：中断时正在等用户回答的问题原文 */
  pendingQuestion?: string | null;
}

/** 纯函数：把中断 run 的事实整理成给模型的说明，不做任何猜测性的“已完成”表述。 */
export function formatInterruptedRunNotice(input: InterruptedRunNoticeInput): string {
  const { run, steps, artifacts } = input;
  const lines: string[] = [
    `【上次运行中断】${formatTime(run.startedAt)} 开始的一次${run.kind === 'scheduled' ? '定时' : run.kind === 'voice' ? '语音' : ''}任务在应用退出时被中断，没有产生最终回复。`,
  ];

  const succeeded = steps.filter((step) => step.status === 'succeeded');
  const unfinished = steps.filter((step) => step.status !== 'succeeded' && step.status !== 'skipped');
  if (succeeded.length) {
    lines.push(`已确认成功的步骤：${succeeded.map((step) => step.toolName).join('、')}。`);
  }
  if (unfinished.length) {
    lines.push(
      `未完成或失败的步骤：${unfinished.map((step) => `${step.toolName}（${step.status}）`).join('、')}。`,
    );
  }
  if (!succeeded.length && !unfinished.length) {
    lines.push('中断发生在调用任何工具之前。');
  }
  if (artifacts.length) {
    lines.push(`已生成的文件：${artifacts.map((artifact) => artifact.relativePath).join('、')}。`);
  }
  if (input.pendingQuestion?.trim()) {
    lines.push(`当时在等你回答：${input.pendingQuestion.trim()}`);
    lines.push('用户若在这一轮直接回答了这个问题，就按回答继续，不要再问一遍。');
  }
  lines.push('请先向用户简要说明这一情况，再询问是否需要继续；不要把未确认的步骤说成已完成。');
  return lines.join('\n');
}

export interface InterruptedRunNotice {
  runId: string;
  notice: string;
}

/**
 * 为下一轮对话生成中断说明。这里不做“已告知”标记：只有在下一轮 run 成功收口后
 * 才由 orchestrator 调用 acknowledgeInterruptedRun，避免那一轮因模型失败而丢失说明。
 * 数据库不可用或没有中断记录时返回 null。
 */
export function peekInterruptedRunNotice(sessionId: string): InterruptedRunNotice | null {
  if (!isDatabaseReady()) return null;
  try {
    const run = findUnacknowledgedInterruptedRun(sessionId);
    if (!run) return null;
    return {
      runId: run.id,
      notice: formatInterruptedRunNotice({
        run,
        steps: listTaskRunSteps(run.id),
        artifacts: listRunArtifacts(run.id),
        pendingQuestion: findInterruptedQuestion(run.id)?.question ?? null,
      }),
    };
  } catch (error) {
    console.warn('[run-recovery] 读取中断记录失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 下一轮成功回复后调用。把该会话所有未告知的中断 run 一并标记，
 * 否则连续两次崩溃留下的更早记录会在再下一轮冒出来，被当成"上次运行"。
 */
export function acknowledgeInterruptedRuns(sessionId: string): void {
  if (!isDatabaseReady()) return;
  try {
    acknowledgeInterruptedRunsForSession(sessionId);
  } catch (error) {
    console.warn('[run-recovery] 标记中断说明已告知失败:', error instanceof Error ? error.message : error);
  }
}
