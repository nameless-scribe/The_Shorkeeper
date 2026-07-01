import type { ReactNode } from 'react';

interface PluginCardProps {
  icon: string;
  title: string;
  description: string;
  control: ReactNode;
  footer?: ReactNode;
}

export function PluginCard({ icon, title, description, control, footer }: PluginCardProps) {
  return (
    <div className="keeper-glass-soft rounded-2xl border border-keeper-silver/12 px-4 py-3.5 transition hover:border-keeper-silver/20">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-keeper-cyan/15 to-keeper-cyan/5 text-lg shadow-inset-accent-soft">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-keeper-ice">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-keeper-ice/55">{description}</p>
            </div>
            <div className="shrink-0">{control}</div>
          </div>
          {footer && <div className="mt-3 border-t border-keeper-ice/8 pt-3">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function PluginStatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        active ? 'bg-emerald-400 shadow-emerald-dot' : 'bg-keeper-silver/30'
      }`}
      title={active ? '已启用' : '已关闭'}
    />
  );
}
