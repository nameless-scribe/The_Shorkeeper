export interface SingleInstanceRuntime {
  requestLock(): boolean;
  onSecondInstance(handler: () => void): void;
  quit(): void;
}

/**
 * 在任何数据库或后台运行时启动前取得进程级互斥。
 * 未取得锁的进程只负责退出；已有实例收到通知后自行恢复主窗口。
 */
export function installSingleInstanceGuard(
  runtime: SingleInstanceRuntime,
  revealPrimaryWindow: () => void,
): boolean {
  if (!runtime.requestLock()) {
    runtime.quit();
    return false;
  }
  runtime.onSecondInstance(revealPrimaryWindow);
  return true;
}
