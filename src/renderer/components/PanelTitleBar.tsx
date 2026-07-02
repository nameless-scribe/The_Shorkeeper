interface PanelTitleBarProps {
  title: string;
  subtitle?: string;
}

export function PanelTitleBar({ title, subtitle }: PanelTitleBarProps) {
  return (
    <header className="drag-region keeper-glass-panel flex shrink-0 items-center justify-between rounded-t-3xl border-b border-keeper-cyan/15 px-4 py-3">
      <div>
        <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">{title}</h1>
        {subtitle && <p className="text-xs text-keeper-ice/60">{subtitle}</p>}
      </div>
      <div className="no-drag flex gap-1">
        <button
          type="button"
          onClick={() => window.shorekeeper.window.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
          title="最小化"
        >
          ─
        </button>
        <button
          type="button"
          onClick={() => window.shorekeeper.window.close()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-red-500/20 hover:text-red-300"
          title="关闭"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
