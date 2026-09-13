/**
 * 协调器：合并短时间内的重复信号，启动后延迟做一次有界校对，唤醒后局部校对，
 * 低频兜底扫描；同一时刻只跑一个采集周期，关闭时取消定时器并等待当前周期结束。
 * 纯定时逻辑，不依赖 Electron，便于用假定时器测试。
 */
import type { ProactiveEventDomain } from '../shared/types';

export type ProactivityCycleTrigger = 'startup' | 'signal' | 'wake' | 'sweep' | 'manual' | 'deferred';

export interface ProactivityCoordinatorOptions {
  run: (domains: ReadonlySet<ProactiveEventDomain> | null, trigger: ProactivityCycleTrigger) => Promise<void>;
  debounceMs?: number;
  startupDelayMs?: number;
  sweepIntervalMs?: number;
  /** 延后投递的补发检查间隔 */
  deferredCheckMs?: number;
  onError?: (error: unknown, trigger: ProactivityCycleTrigger) => void;
}

export interface ProactivityCoordinator {
  start(): void;
  signal(domain: ProactiveEventDomain): void;
  wake(): void;
  requestFullCycle(trigger?: ProactivityCycleTrigger): Promise<void>;
  stop(timeoutMs?: number): Promise<void>;
  isRunning(): boolean;
  isStopped(): boolean;
}

const TRIGGER_RANK: Record<ProactivityCycleTrigger, number> = {
  signal: 0,
  deferred: 1,
  wake: 2,
  manual: 3,
  sweep: 4,
  startup: 5,
};

export const DEFAULT_DEBOUNCE_MS = 1_500;
export const DEFAULT_STARTUP_DELAY_MS = 8_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_DEFERRED_CHECK_MS = 60 * 1000;

export function createProactivityCoordinator(options: ProactivityCoordinatorOptions): ProactivityCoordinator {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const startupDelayMs = options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const deferredCheckMs = options.deferredCheckMs ?? DEFAULT_DEFERRED_CHECK_MS;

  let stopped = false;
  let running: Promise<void> | null = null;
  let pendingDomains: Set<ProactiveEventDomain> | null = null;
  let pendingFull = false;
  let pendingTrigger: ProactivityCycleTrigger = 'signal';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let deferredTimer: ReturnType<typeof setInterval> | null = null;
  const waiters: Array<() => void> = [];

  const clearDebounce = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
  };

  const settleWaiters = () => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  async function execute(domains: ReadonlySet<ProactiveEventDomain> | null, trigger: ProactivityCycleTrigger): Promise<void> {
    try {
      await options.run(domains, trigger);
    } catch (error) {
      options.onError?.(error, trigger);
    }
  }

  function drain(): void {
    if (stopped || running) return;
    if (!pendingFull && !pendingDomains) {
      settleWaiters();
      return;
    }
    const domains = pendingFull ? null : pendingDomains;
    const trigger = pendingTrigger;
    pendingFull = false;
    pendingDomains = null;
    pendingTrigger = 'signal';
    running = execute(domains, trigger).finally(() => {
      running = null;
      // 运行期间又来了信号：紧接着再跑一轮，避免丢失变化。
      if (pendingFull || pendingDomains) {
        drain();
      } else {
        settleWaiters();
      }
    });
  }

  function scheduleDrain(delay: number): void {
    if (stopped) return;
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      drain();
    }, delay);
  }

  function enqueue(domains: ReadonlySet<ProactiveEventDomain> | null, trigger: ProactivityCycleTrigger, delay: number): Promise<void> {
    if (stopped) return Promise.resolve();
    if (domains == null) {
      pendingFull = true;
    } else if (!pendingFull) {
      pendingDomains ??= new Set();
      for (const domain of domains) pendingDomains.add(domain);
    }
    // 更"重要"的触发原因覆盖较弱的原因：startup / sweep 会做保留策略清理，不能被 deferred 抢掉标签。
    if (TRIGGER_RANK[trigger] > TRIGGER_RANK[pendingTrigger]) pendingTrigger = trigger;
    const promise = new Promise<void>((resolve) => waiters.push(resolve));
    scheduleDrain(delay);
    return promise;
  }

  return {
    start() {
      if (stopped) return;
      startupTimer = setTimeout(() => {
        startupTimer = null;
        void enqueue(null, 'startup', 0);
      }, startupDelayMs);
      sweepTimer = setInterval(() => {
        void enqueue(null, 'sweep', 0);
      }, sweepIntervalMs);
      deferredTimer = setInterval(() => {
        // 延后投递只需要检查投递账本，不重新扫描来源：传空集合。
        void enqueue(new Set(), 'deferred', 0);
      }, deferredCheckMs);
    },
    signal(domain) {
      void enqueue(new Set([domain]), 'signal', debounceMs);
    },
    wake() {
      void enqueue(null, 'wake', debounceMs);
    },
    requestFullCycle(trigger = 'manual') {
      return enqueue(null, trigger, 0);
    },
    async stop(timeoutMs = 5_000) {
      stopped = true;
      clearDebounce();
      if (startupTimer) clearTimeout(startupTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (deferredTimer) clearInterval(deferredTimer);
      startupTimer = null;
      sweepTimer = null;
      deferredTimer = null;
      pendingFull = false;
      pendingDomains = null;
      settleWaiters();
      if (running) {
        await Promise.race([
          running,
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
      }
    },
    isRunning: () => running != null,
    isStopped: () => stopped,
  };
}
