import { getWindowManager } from '../windows/manager';
import { hideDockWindow, showDockWindow } from '../windows/dock';

const MAIN_PANELS = ['chat', 'status', 'schedule'] as const;

/** 是否有主面板实际显示在屏幕上（逻辑打开且 win.isVisible） */
export function isAnyMainPanelOnScreen(): boolean {
  const manager = getWindowManager();
  for (const kind of MAIN_PANELS) {
    if (!manager.isPanelShown(kind)) continue;
    const win = manager.get(kind);
    if (win && win.isVisible()) return true;
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
