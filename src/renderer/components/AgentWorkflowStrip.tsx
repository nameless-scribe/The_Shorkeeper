import type { AgentWorkflowStatus } from '../hooks/agent-workflow';
import { AgentWorkflowBar } from './AgentWorkflowBar';

interface AgentWorkflowStripProps {
  status: AgentWorkflowStatus;
}

export function AgentWorkflowStrip({ status }: AgentWorkflowStripProps) {
  const active = status.mode !== 'idle';

  return (
    <div
      className={`no-drag shrink-0 border-b transition-[padding,background-color,border-color] duration-200 ${
        active
          ? 'border-keeper-cyan/25 bg-[#0a1128]/92 py-2.5 backdrop-blur-md'
          : 'border-keeper-cyan/8 bg-[#0a1128]/55 py-1.5'
      }`}
    >
      <div className="px-4">
        <AgentWorkflowBar status={status} />
      </div>
    </div>
  );
}
