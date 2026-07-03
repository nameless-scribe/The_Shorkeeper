/** 主进程在启动时注册：广播 UI 刷新 */
let onUserTasksChanged: (() => void) | null = null;

export function setUserTaskChangeHandler(handler: () => void): void {
  onUserTasksChanged = handler;
}

export function notifyUserTasksChanged(): void {
  onUserTasksChanged?.();
}
