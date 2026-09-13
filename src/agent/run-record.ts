import { isDatabaseReady } from '../db/state';
import {
  createTaskRun,
  endTaskRunStep,
  finishTaskRun,
  recordRunArtifacts,
  setTaskRunModel,
  startTaskRunStep,
  updateTaskRunPhase,
} from '../db/repositories/task-runs';
import {
  recordTaskRunContextSources,
  type CreateTaskRunContextSourceInput,
} from '../db/repositories/context-sources';
import type { TaskRunKind, TaskRunPhase } from '../shared/types';
import type { ToolResult, ToolSideEffectContract } from '../tools/types';
import type { RunPhase } from './run-lifecycle';

export interface RunRecorderInput {
  runId: string;
  sessionId: string;
  kind?: TaskRunKind;
  triggerRef?: string | null;
  /** 缺省按数据库就绪状态决定；测试可显式开关。 */
  enabled?: boolean;
  logger?: (message: string) => void;
}

type NonTerminalPhase = Exclude<TaskRunPhase, 'finished' | 'cancelled' | 'error' | 'interrupted'>;

/**
 * 把一次 run 的生命周期、工具步骤、产物与终态写入数据库。
 * 记录失败绝不影响 run 本身：中途写入失败后记录器进入降级状态，停止步骤/阶段写入；
 * 但终态仍会尝试写入一次，否则一条已正常结束的 run 会在下次启动时被误判为中断。
 */
export class RunRecorder {
  private readonly enabled: boolean;
  private degraded = false;
  private started = false;
  private finished = false;
  private readonly stepContracts = new Map<string, ToolSideEffectContract | undefined>();
  private readonly logger: (message: string) => void;

  constructor(private readonly input: RunRecorderInput) {
    this.enabled = input.enabled ?? isDatabaseReady();
    this.logger = input.logger ?? ((message) => console.warn(`[run-record] ${message}`));
  }

  isEnabled(): boolean {
    return this.enabled && !this.degraded;
  }

  private attempt(label: string, operation: () => void): boolean {
    try {
      operation();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger(`${label} 写入失败: ${message}`);
      return false;
    }
  }

  private guard(label: string, operation: () => void): void {
    if (!this.isEnabled()) return;
    if (!this.attempt(label, operation)) {
      this.degraded = true;
      this.logger('本次 run 的步骤与阶段记录已停止，终态仍会尝试写入');
    }
  }

  start(modelId?: string): void {
    if (this.started || !this.enabled) return;
    this.started = true;
    this.guard('task_runs.insert', () => {
      createTaskRun({
        id: this.input.runId,
        sessionId: this.input.sessionId,
        kind: this.input.kind ?? 'chat',
        triggerRef: this.input.triggerRef ?? null,
        modelId: modelId ?? null,
      });
    });
    // 连 run 行都没写进去，后续任何写入都没有意义。
    if (this.degraded) this.started = false;
  }

  setModel(modelId: string | undefined): void {
    if (!this.started || this.finished || !modelId) return;
    this.guard('task_runs.model', () => setTaskRunModel(this.input.runId, modelId));
  }

  context(sources: CreateTaskRunContextSourceInput[]): void {
    if (!this.started || this.finished || !sources.length) return;
    this.guard('task_run_context_sources.insert', () => {
      recordTaskRunContextSources(this.input.runId, sources);
    });
  }

  phase(phase: RunPhase | NonTerminalPhase): void {
    if (!this.started || this.finished) return;
    if (phase === 'finished' || phase === 'cancelled' || phase === 'error') return;
    this.guard('task_runs.phase', () => {
      updateTaskRunPhase(this.input.runId, phase);
    });
  }

  waitingApproval(): void {
    this.phase('waiting_approval');
  }

  stepStart(callId: string, toolName: string, contract?: ToolSideEffectContract): void {
    if (!this.started || this.finished) return;
    this.stepContracts.set(callId, contract);
    this.guard('task_run_steps.insert', () => {
      startTaskRunStep({
        runId: this.input.runId,
        callId,
        toolName,
        riskLevel: contract?.risk ?? null,
        idempotent: contract?.idempotent ?? false,
      });
    });
  }

  stepEnd(callId: string, toolName: string, result: ToolResult): void {
    if (!this.started || this.finished) return;
    const contract = this.stepContracts.get(callId);
    this.stepContracts.delete(callId);
    this.guard('task_run_steps.end', () => {
      const merged = Boolean(result.metadata?.duplicateSuppressed);
      const replayed = Boolean(result.metadata?.replayedToolCall);
      // 只有声明产生文件产物的工具，其 artifacts 才算完成证据；
      // read_file 之类把输入文件当附件返回的只读工具不能被记成"已生成的文件"。
      if (result.success && result.artifacts?.length && !merged && !replayed && contract?.evidence === 'artifact') {
        recordRunArtifacts({
          runId: this.input.runId,
          callId,
          sessionId: this.input.sessionId,
          toolName,
          artifacts: result.artifacts,
        });
      }
      endTaskRunStep(this.input.runId, callId, {
        status: merged
          ? 'skipped'
          : result.success
            ? 'succeeded'
            : result.errorCategory === 'cancelled'
              ? 'cancelled'
              : 'failed',
        errorCategory: result.success ? null : result.errorCategory ?? null,
        errorSummary: merged
          ? '与本轮此前相同参数的成功调用合并，未重复执行'
          : result.success
            ? null
            : result.error ?? null,
      });
    });
  }

  finish(
    phase: Extract<TaskRunPhase, 'finished' | 'cancelled' | 'error'>,
    terminalReason: string,
    errorSummary?: string,
    assistantMessageId?: string | null,
  ): void {
    if (!this.started || this.finished) return;
    this.finished = true;
    // 有意绕过降级判断：终态必须尝试写入。
    this.attempt('task_runs.finish', () => {
      finishTaskRun(this.input.runId, {
        phase,
        terminalReason,
        errorSummary: errorSummary ?? null,
        assistantMessageId: assistantMessageId ?? null,
      });
    });
  }
}

export function createRunRecorder(input: RunRecorderInput): RunRecorder {
  return new RunRecorder(input);
}
