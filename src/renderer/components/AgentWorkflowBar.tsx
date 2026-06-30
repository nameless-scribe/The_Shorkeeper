import type { AgentWorkflowStatus, WorkflowStep } from '../hooks/agent-workflow';

interface AgentWorkflowBarProps {
  status: AgentWorkflowStatus;
}

function StepNode({ step }: { step: WorkflowStep }) {
  const isActive = step.state === 'active';
  const isDone = step.state === 'done';
  const isSkipped = step.state === 'skipped';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
          isActive
            ? 'bg-keeper-cyan text-keeper-navyDeep shadow-[0_0_12px_rgba(48,188,237,0.65)]'
            : isDone
              ? 'bg-emerald-500/30 text-emerald-200'
              : isSkipped
                ? 'bg-keeper-ice/8 text-keeper-ice/30'
                : 'border border-keeper-ice/20 bg-keeper-navyDeep/80 text-keeper-ice/40'
        }`}
      >
        {isDone ? '✓' : isSkipped ? '—' : isActive ? '●' : '○'}
      </span>
      <span
        className={`whitespace-nowrap text-[11px] font-medium ${
          isActive
            ? 'text-keeper-cyan'
            : isDone
              ? 'text-keeper-ice/60'
              : isSkipped
                ? 'text-keeper-ice/28 line-through'
                : 'text-keeper-ice/38'
        }`}
      >
        {step.label}
      </span>
    </div>
  );
}

export function AgentWorkflowBar({ status }: AgentWorkflowBarProps) {
  if (status.mode === 'idle') {
    return (
      <div className="flex items-center justify-center gap-2 text-center">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-keeper-cyan/50" />
        <p className="text-[11px] text-keeper-ice/50">
          {status.headline}
          <span className="text-keeper-ice/30"> · {status.detail}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {status.steps.map((s, index) => (
          <div key={s.id} className="flex items-center gap-2">
            <StepNode step={s} />
            {index < status.steps.length - 1 ? (
              <span
                className={`hidden h-px w-4 sm:inline-block ${
                  s.state === 'done' ? 'bg-emerald-400/50' : 'bg-keeper-ice/18'
                }`}
              />
            ) : null}
          </div>
        ))}
      </div>
      <p className="max-w-full truncate px-2 text-center text-[12px]">
        <span
          className={`font-semibold ${
            status.mode === 'permission' ? 'text-amber-300' : 'text-keeper-cyan'
          }`}
        >
          {status.headline}
        </span>
        {status.detail ? (
          <span className="text-keeper-ice/55"> · {status.detail}</span>
        ) : null}
      </p>
    </div>
  );
}
