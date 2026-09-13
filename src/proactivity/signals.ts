import type { ProactiveEventDomain } from '../shared/types';

/**
 * 轻量状态变化信号：领域模块（Repository / 调度器 / 文档同步）只报告"某个域变了"，
 * 不写事件表；主进程注册的协调器合并信号后由 collector 查询真源并幂等投影。
 * 未注册处理器（测试、脚本）时为 no-op。
 */
type LocalStateChangeHandler = (domain: ProactiveEventDomain) => void;

let handler: LocalStateChangeHandler | null = null;

export function setLocalStateChangeHandler(next: LocalStateChangeHandler | null): void {
  handler = next;
}

export function notifyLocalStateChanged(domain: ProactiveEventDomain): void {
  if (!handler) return;
  try {
    handler(domain);
  } catch (error) {
    console.warn('[proactivity] 状态变化信号处理失败:', error instanceof Error ? error.message : error);
  }
}
