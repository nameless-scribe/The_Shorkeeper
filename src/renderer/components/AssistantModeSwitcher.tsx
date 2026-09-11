import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistantMode } from '@/shared/types';
import {
  ASSISTANT_MODE_HINTS,
  ASSISTANT_MODE_LABELS,
  ASSISTANT_MODES,
} from '@/assistant/mode';

interface AssistantModeSwitcherProps {
  value: AssistantMode;
  disabled?: boolean;
  onChange: (mode: AssistantMode) => void;
}

export function AssistantModeSwitcher({
  value,
  disabled,
  onChange,
}: AssistantModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = rootRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`助理模式：${ASSISTANT_MODE_LABELS[value]}`}
        title={ASSISTANT_MODE_HINTS[value]}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 max-w-[148px] items-center gap-1.5 rounded-lg border border-keeper-cyan/15 bg-keeper-navyDeep/45 px-2 text-[11px] text-keeper-ice/70 transition hover:border-keeper-cyan/30 hover:bg-keeper-cyan/10 hover:text-keeper-cyan disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="shrink-0 text-[9px] text-keeper-cyan/80">◆</span>
        <span className="min-w-0 truncate">{ASSISTANT_MODE_LABELS[value]}</span>
        <span className={`shrink-0 text-[8px] text-keeper-ice/35 transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: menuPos.top, right: menuPos.right }}
            className="fixed z-[80] w-[248px] overflow-hidden rounded-xl border border-keeper-cyan/20 bg-keeper-navyDeep/95 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md"
          >
            <p className="px-2.5 py-1.5 text-[10px] font-medium text-keeper-ice/40">助理模式</p>
            <ul role="listbox" aria-label="助理模式">
              {ASSISTANT_MODES.map((mode) => {
                const active = mode === value;
                return (
                  <li key={mode} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(mode);
                        setOpen(false);
                      }}
                      className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition ${
                        active
                          ? 'bg-keeper-cyan/15 text-keeper-cyan'
                          : 'text-keeper-ice/80 hover:bg-keeper-silver/10 hover:text-keeper-ice'
                      }`}
                    >
                      <span className="text-xs font-medium">{ASSISTANT_MODE_LABELS[mode]}</span>
                      <span className={`mt-0.5 text-[10px] leading-snug ${active ? 'text-keeper-cyan/70' : 'text-keeper-ice/40'}`}>
                        {ASSISTANT_MODE_HINTS[mode]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
