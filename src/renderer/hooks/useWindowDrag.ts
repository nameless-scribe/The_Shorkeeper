import { useCallback, useRef } from 'react';

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, .no-drag';

export function useWindowDrag() {
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;

    pointerRef.current = { x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const start = pointerRef.current;
    if (!start) return;

    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;
    if (dx === 0 && dy === 0) return;

    start.x = event.screenX;
    start.y = event.screenY;
    window.shorekeeper.window.moveBy(dx, dy);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
