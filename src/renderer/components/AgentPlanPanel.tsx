import type { AgentPlanItem } from '@/shared/types';

interface AgentPlanPanelProps {
  items: AgentPlanItem[];
}

const STATUS_ICON: Record<AgentPlanItem['status'], string> = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
  cancelled: '—',
  waiting_user: '?',
};

export function AgentPlanPanel({ items }: AgentPlanPanelProps) {
  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-keeper-cyan/20 bg-keeper-navy/50 px-3 py-2">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-keeper-ice/45">
        执行计划
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex items-start gap-2 text-[11px] leading-snug ${
              item.status === 'completed'
                ? 'text-keeper-ice/50 line-through'
                : item.status === 'cancelled'
                  ? 'text-keeper-ice/35 line-through'
                  : item.status === 'in_progress' || item.status === 'waiting_user'
                    ? 'text-keeper-cyan'
                    : 'text-keeper-ice/75'
            }`}
          >
            <span className="mt-0.5 shrink-0 font-mono text-[10px]">
              {STATUS_ICON[item.status]}
            </span>
            <span>{item.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
