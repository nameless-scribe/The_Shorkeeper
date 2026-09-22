import { reconcileInterruptedRuns } from '../agent/run-recovery';
import { failStaleRunningTranscripts } from '../db/repositories/audio-transcripts';
import { markInterruptedQueryRuns } from '../db/repositories/datasources';
import { recoverInterruptedErpReportBatches } from '../db/repositories/erp-work-reports';

export interface StartupRecoveryReport {
  agentRuns: ReturnType<typeof reconcileInterruptedRuns>;
  audioTranscripts: number;
  queryRuns: number;
  erpBatches: ReturnType<typeof recoverInterruptedErpReportBatches>;
}

interface StartupRecoveryDependencies {
  reconcileAgentRuns: () => ReturnType<typeof reconcileInterruptedRuns>;
  failAudioTranscripts: () => number;
  interruptQueryRuns: () => number;
  interruptErpBatches: () => ReturnType<typeof recoverInterruptedErpReportBatches>;
}

const defaultDependencies: StartupRecoveryDependencies = {
  reconcileAgentRuns: reconcileInterruptedRuns,
  failAudioTranscripts: failStaleRunningTranscripts,
  interruptQueryRuns: markInterruptedQueryRuns,
  interruptErpBatches: recoverInterruptedErpReportBatches,
};

/**
 * 收口上次进程遗留的运行态记录。必须在数据库初始化完成、启动任何新后台任务前调用；
 * 任一步失败都向上抛出，避免应用带着不一致账本继续启动。
 */
export function recoverInterruptedRuntimeState(
  dependencies: StartupRecoveryDependencies = defaultDependencies,
): StartupRecoveryReport {
  return {
    agentRuns: dependencies.reconcileAgentRuns(),
    audioTranscripts: dependencies.failAudioTranscripts(),
    queryRuns: dependencies.interruptQueryRuns(),
    erpBatches: dependencies.interruptErpBatches(),
  };
}
