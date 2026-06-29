/** 主进程在启动时注册：reload cron + 广播 UI 刷新 */
let onTasksChanged: (() => void) | null = null;

export function setTaskChangeHandler(handler: () => void): void {
  onTasksChanged = handler;
}

export function notifyTasksChanged(): void {
  onTasksChanged?.();
}
