import { setImmediate as waitImmediate } from 'node:timers/promises';
import {
  abortAllSessionRuns,
  acquireSessionRun,
  awaitSessionRunsIdle,
  beginSessionRunShutdown,
  listActiveSessionRuns,
  releaseSessionRun,
  setSessionRunId,
} from '../src/agent/session-run-lock';
import {
  scheduleMemoryExtract,
  scheduleSessionCompress,
  shutdownPendingSessionWork,
} from '../src/agent/session-background';
import {
  shutdownRagOperations,
  trackRagOperation,
} from '../src/rag/operation-runtime';
import { coordinateRuntimeShutdown } from '../src/runtime/shutdown-coordinator';

const sessionRunCount = 200;
const backgroundTaskCount = 500;
const ragOperationCount = 500;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function activeHandleCount(): number {
  const getHandles = (process as typeof process & {
    _getActiveHandles?: () => unknown[];
  })._getActiveHandles;
  return getHandles ? getHandles().length : 0;
}

function mib(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

global.gc?.();
const initialRss = process.memoryUsage().rss;
const initialHandles = activeHandleCount();
const startedAt = performance.now();

for (let index = 0; index < sessionRunCount; index += 1) {
  const sessionId = `runtime-soak-${index}`;
  const controller = acquireSessionRun(sessionId);
  assert(controller, `无法获取会话运行锁: ${sessionId}`);
  setSessionRunId(sessionId, `run-${index}`);
  controller.signal.addEventListener('abort', () => {
    queueMicrotask(() => releaseSessionRun(sessionId, controller));
  }, { once: true });
}

const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  if (args[0] !== '[agent.background]') originalInfo(...args);
};

for (let index = 0; index < backgroundTaskCount; index += 1) {
  const schedule = index % 2 === 0 ? scheduleSessionCompress : scheduleMemoryExtract;
  schedule(
    `background-soak-${index % 50}`,
    (signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(index), { once: true });
    }),
    `background-run-${index}`,
  );
}

for (let index = 0; index < ragOperationCount; index += 1) {
  void trackRagOperation((signal) => new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  }));
}

let voiceShutdowns = 0;
let updaterShutdowns = 0;
let timerCleanups = 0;
let databaseCloses = 0;
const result = await coordinateRuntimeShutdown({
  beginSessionRunShutdown,
  cancelAllPendingPermissions: () => undefined,
  cancelAllPendingQuestions: () => undefined,
  abortAllSessionRuns,
  shutdownVoiceRuntime: () => { voiceShutdowns += 1; },
  shutdownAutoUpdaterRuntime: () => { updaterShutdowns += 1; },
  clearStartupTimers: () => { timerCleanups += 1; },
  awaitSessionRunsIdle,
  shutdownPendingSessionWork,
  shutdownDocumentsRuntime: shutdownRagOperations,
  closeDatabase: async () => { databaseCloses += 1; },
}, 5_000);
console.info = originalInfo;

await waitImmediate();
global.gc?.();
const finalRss = process.memoryUsage().rss;
const finalHandles = activeHandleCount();
const retainedRss = finalRss - initialRss;
const handleDelta = finalHandles - initialHandles;

assert(result.runsIdle && result.backgroundIdle && result.ragIdle, '运行时未在宽限期内收敛');
assert(result.databaseClosed && databaseCloses === 1, '数据库关闭屏障未执行');
assert(result.errors.length === 0, `退出协调错误: ${result.errors.join('; ')}`);
assert(listActiveSessionRuns().length === 0, '会话运行锁未清空');
assert(voiceShutdowns === 1 && updaterShutdowns === 1 && timerCleanups === 1, '同步清理未且仅执行一次');
assert(retainedRss < 48 * 1024 * 1024, `取消收敛后 RSS 增长过高: ${mib(retainedRss)} MiB`);
assert(handleDelta <= 0, `取消收敛后活动句柄未回落: +${handleDelta}`);

console.log(JSON.stringify({
  sessionRuns: sessionRunCount,
  backgroundTasks: backgroundTaskCount,
  ragOperations: ragOperationCount,
  elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
  allIdle: true,
  activeSessionRuns: listActiveSessionRuns().length,
  retainedRssMiB: mib(retainedRss),
  activeHandleDelta: handleDelta,
  databaseCloseCount: databaseCloses,
}, null, 2));
