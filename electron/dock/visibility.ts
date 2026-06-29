import { getWindowManager } from '../windows/manager';
import { hideDockWindow, showDockWindow } from '../windows/dock';

const MAIN_PANELS = ['chat', 'status', 'schedule'] as const;

/** 是否有主面板正在屏幕上展示（非隐藏、非最小化） */
export function isAnyMainPanelOnScreen(): boolean {
  const manager = getWindowManager();
  for (const kind of MAIN_PANELS) {
    const win = manager.get(kind);
    if (win && win.isVisible() && !win.isMinimized()) {
      return true;
    }
  }
  return false;
}

export function syncDockVisibility(): void {
  if (isAnyMainPanelOnScreen()) {
    hideDockWindow();
  } else {
    showDockWindow();
  }
}

export function attachMainPanelDockSync(): void {
  const manager = getWindowManager();

  for (const kind of MAIN_PANELS) {
    const win = manager.get(kind);
    if (!win) continue;

    const sync = () => syncDockVisibility();
    win.on('show', sync);
    win.on('hide', sync);
    win.on('minimize', sync);
    win.on('restore', sync);
  }
}
