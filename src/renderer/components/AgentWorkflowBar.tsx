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
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all ${
          isActive
            ? 'bg-keeper-cyan text-keeper-navyDeep shadow-[0_0_10px_rgba(0,212,255,0.55)]'
            : isDone
              ? 'bg-emerald-500/25 text-emerald-300'
              : isSkipped
                ? 'bg-keeper-ice/5 text-keeper-ice/25'
                : 'bg-keeper-ice/8 text-keeper-ice/35'
        }`}
      >
        {isDone ? '✓' : isSkipped ? '—' : isActive ? '●' : '○'}
      </span>
      <span
        className={`text-[10px] font-medium tracking-wide ${
          isActive
            ? 'text-keeper-cyan'
            : isDone
              ? 'text-keeper-ice/55'
              : isSkipped
                ? 'text-keeper-ice/25 line-through'
                : 'text-keeper-ice/35'
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
      <div className="flex min-w-0 flex-col items-center justify-center text-center">
        <p className="text-[11px] font-medium text-keeper-ice/45">
          <span className="text-keeper-cyan/70">◈</span> {status.headline}
          {status.detail ? (
            <span className="text-keeper-ice/30"> · {status.detail}</span>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-md flex-col items-center gap-1.5">
      <div className="flex items-center gap-2">
        {status.steps.map((s, index) => (
          <div key={s.id} className="flex items-center gap-2">
            <StepNode step={s} />
            {index < status.steps.length - 1 ? (
              <span
                className={`h-px w-3 ${
                  s.state === 'done' ? 'bg-emerald-400/40' : 'bg-keeper-ice/15'
                }`}
              />
            ) : null}
          </div>
        ))}
      </div>
      <p className="max-w-full truncate text-center text-[11px]">
        <span
          className={`font-medium ${
            status.mode === 'permission' ? 'text-amber-300' : 'text-keeper-cyan'
          }`}
        >
          {status.headline}
        </span>
        {status.detail ? (
          <span className="text-keeper-ice/50"> · {status.detail}</span>
        ) : null}
      </p>
    </div>
  );
}
