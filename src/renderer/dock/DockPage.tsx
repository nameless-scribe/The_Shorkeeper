import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockPreferencesInfo } from '@/shared/types';
import { AgentAvatar } from '../components/AgentAvatar';
import { DockScheduleBar } from './DockScheduleBar';
import { DockStatusBar } from './DockStatusBar';
import { DockTokenBar } from './DockTokenBar';

const DRAG_THRESHOLD_PX = 6;

const DEFAULT_PREFS: DockPreferencesInfo = {
  alwaysOnTop: true,
  positionLocked: false,
};

export function DockPage() {
  const pointerRef = useRef<{ x: number; y: number; moved: boolean; target: EventTarget | null } | null>(
    null,
  );
  const [prefs, setPrefs] = useState<DockPreferencesInfo>(DEFAULT_PREFS);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('panel-transparent');

    window.shorekeeper.dock.getPreferences().then(setPrefs).catch(console.error);

    return () => {
      document.documentElement.classList.remove('panel-transparent');
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button.no-drag')) return;
      if (prefs.positionLocked) return;

      pointerRef.current = {
        x: event.screenX,
        y: event.screenY,
        moved: false,
        target: event.target,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [prefs.positionLocked],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start) return;

    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;

    if (!start.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      start.moved = true;
    }

    if (start.moved) {
      void window.shorekeeper.dock.moveBy(dx, dy);
      start.x = event.screenX;
      start.y = event.screenY;
    }
  }, []);

  const handlePointerUp = useCallback(async (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!start || start.moved) return;

    const el = (start.target as HTMLElement)?.closest?.('[data-dock-action]');
    const action = el?.getAttribute('data-dock-action');
    if (action === 'chat') {
      await window.shorekeeper.dock.openChat();
    } else if (action === 'status') {
      await window.shorekeeper.dock.openStatus();
    } else if (action === 'schedule') {
      await window.shorekeeper.dock.openSchedule();
    }
  }, []);

  const toggleAlwaysOnTop = async () => {
    const next = await window.shorekeeper.dock.setAlwaysOnTop(!prefs.alwaysOnTop);
    setPrefs(next);
  };

  const togglePositionLocked = async () => {
    const next = await window.shorekeeper.dock.setPositionLocked(!prefs.positionLocked);
    setPrefs(next);
  };

  const showControls = hovered || !prefs.alwaysOnTop || prefs.positionLocked;

  return (
    <div
      className={`group flex h-screen w-screen flex-col bg-transparent px-2 py-2 ${
        prefs.positionLocked ? '' : 'cursor-grab active:cursor-grabbing'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerRef.current = null;
      }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col justify-center">
        <div
          className={`absolute right-0 top-0 z-10 flex items-center gap-1 rounded-full border border-keeper-cyan/20 bg-keeper-navyDeep/80 px-1.5 py-1 backdrop-blur-sm transition-opacity ${
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            title={prefs.alwaysOnTop ? '取消置顶' : '窗口置顶'}
            aria-label={prefs.alwaysOnTop ? '取消置顶' : '窗口置顶'}
            aria-pressed={prefs.alwaysOnTop}
            onClick={() => toggleAlwaysOnTop().catch(console.error)}
            className={`no-drag flex h-6 w-6 items-center justify-center rounded-full text-xs transition ${
              prefs.alwaysOnTop
                ? 'bg-keeper-cyan/25 text-keeper-cyan'
                : 'text-keeper-ice/50 hover:bg-white/10 hover:text-keeper-ice'
            }`}
          >
            📌
          </button>
          <button
            type="button"
            title={prefs.positionLocked ? '解除固定位置' : '固定位置'}
            aria-label={prefs.positionLocked ? '解除固定位置' : '固定位置'}
            aria-pressed={prefs.positionLocked}
            onClick={() => togglePositionLocked().catch(console.error)}
            className={`no-drag flex h-6 w-6 items-center justify-center rounded-full text-xs transition ${
              prefs.positionLocked
                ? 'bg-keeper-cyan/25 text-keeper-cyan'
                : 'text-keeper-ice/50 hover:bg-white/10 hover:text-keeper-ice'
            }`}
          >
            📍
          </button>
        </div>

        <div className="flex items-center gap-2 pt-5">
          <div
            data-dock-action="chat"
            title={prefs.positionLocked ? '打开聊天' : '点击打开聊天 · 按住拖动可移动'}
            aria-label="打开守岸人聊天窗"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              void window.shorekeeper.dock.openChat();
            }}
            className="relative shrink-0 cursor-grab rounded-full outline-none transition-transform active:cursor-grabbing hover:scale-105 active:scale-95"
          >
            <span
              aria-hidden
              className="absolute inset-0 -m-1 rounded-full bg-keeper-cyan/25 opacity-70 blur-md transition-opacity group-hover:opacity-100"
            />
            <AgentAvatar
              size="lg"
              className="relative !h-[64px] !w-[64px] border-keeper-cyan/60 shadow-cyan ring-2 ring-keeper-cyan/30"
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DockStatusBar />
            <DockScheduleBar />
            <DockTokenBar />
          </div>
        </div>
      </div>
    </div>
  );
}
