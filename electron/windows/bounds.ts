import { screen } from 'electron';
import type { WindowBounds } from '../../src/db/schema';

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 与默认值合并并剔除非法数值，避免 DB 里残缺 bounds 导致 NaN 窗口 */
export function normalizeWindowBounds(
  partial: Partial<WindowBounds> | null | undefined,
  defaults: WindowBounds,
): WindowBounds {
  return {
    x: finiteOr(partial?.x, defaults.x),
    y: finiteOr(partial?.y, defaults.y),
    width: finiteOr(partial?.width, defaults.width),
    height: finiteOr(partial?.height, defaults.height),
  };
}

function workAreaForBounds(bounds: WindowBounds) {
  try {
    return screen.getDisplayMatching(bounds).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

/** 将窗口 bounds 限制在当前工作区内，避免换显示器后窗口在屏幕外“消失” */
export function clampBoundsToWorkArea(
  bounds: Partial<WindowBounds>,
  defaults: WindowBounds,
): WindowBounds {
  const normalized = normalizeWindowBounds(bounds, defaults);
  const workArea = workAreaForBounds(normalized);

  const width = Math.min(Math.max(normalized.width, 200), workArea.width);
  const height = Math.min(Math.max(normalized.height, 200), workArea.height);

  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = Math.max(minX, workArea.x + workArea.width - width);
  const maxY = Math.max(minY, workArea.y + workArea.height - height);

  const x = Math.min(Math.max(normalized.x, minX), maxX);
  const y = Math.min(Math.max(normalized.y, minY), maxY);

  return { x, y, width, height };
}

export function isBoundsOnScreen(bounds: WindowBounds, defaults: WindowBounds): boolean {
  const clamped = clampBoundsToWorkArea(bounds, defaults);
  return (
    clamped.x === bounds.x &&
    clamped.y === bounds.y &&
    clamped.width === bounds.width &&
    clamped.height === bounds.height
  );
}
