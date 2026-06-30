import type { PermissionRequestPayload } from '@/shared/types';
import type { UiMessage } from './useAgentEvents';
import { toolDisplayName } from '../components/tool-labels';

export type WorkflowStepId = 'prepare' | 'think' | 'tool' | 'write';

export type WorkflowStepState = 'pending' | 'active' | 'done' | 'skipped';

export interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  state: WorkflowStepState;
}

export interface AgentWorkflowStatus {
  mode: 'idle' | 'running' | 'permission';
  headline: string;
  detail?: string;
  steps: WorkflowStep[];
}

const IDLE_STATUS: AgentWorkflowStatus = {
  mode: 'idle',
  headline: '就绪',
  detail: '等待你的消息',
  steps: [],
};

function step(
  id: WorkflowStepId,
  label: string,
  state: WorkflowStepState,
): WorkflowStep {
  return { id, label, state };
}

export function deriveAgentWorkflow(
  messages: UiMessage[],
  isRunning: boolean,
  permissionRequest: PermissionRequestPayload | null,
): AgentWorkflowStatus {
  if (permissionRequest) {
    return {
      mode: 'permission',
      headline: '等待确认',
      detail: `需要批准：${toolDisplayName(permissionRequest.toolName)}`,
      steps: [
        step('prepare', '准备', 'done'),
        step('think', '思考', 'done'),
        step('tool', '工具', 'active'),
        step('write', '输出', 'pending'),
      ],
    };
  }

  const streamMsg = [...messages].reverse().find((m) => m.role === 'assistant' && m.streaming);
  if (!isRunning && !streamMsg) {
    return IDLE_STATUS;
  }

  const toolCalls = streamMsg?.toolCalls ?? [];
  const runningTool = toolCalls.find((tc) => tc.status === 'running');
  const hasTools = toolCalls.length > 0;
  const allToolsDone = hasTools && toolCalls.every((tc) => tc.status !== 'running');
  const hasContent = Boolean(streamMsg?.content?.trim());
  const isThinking = Boolean(streamMsg?.thinking && !hasContent && !runningTool);

  let current: WorkflowStepId = 'prepare';
  let headline = '准备中';
  let detail: string | undefined;

  if (runningTool) {
    current = 'tool';
    headline = '执行工具';
    detail = toolDisplayName(runningTool.name);
  } else if (hasContent && (isRunning || streamMsg?.streaming)) {
    current = 'write';
    headline = '生成回复';
    detail = '正在输出消息…';
  } else if (isThinking) {
    current = 'think';
    headline = '思考中';
    detail = '分析你的问题…';
  } else if (allToolsDone && isRunning && !hasContent) {
    current = 'think';
    headline = '整理结果';
    detail = '工具已完成，继续推理…';
  } else if (streamMsg) {
    current = 'think';
    headline = '思考中';
  }

  const order: WorkflowStepId[] = ['prepare', 'think', 'tool', 'write'];
  const currentIdx = order.indexOf(current);

  const steps: WorkflowStep[] = [
    step('prepare', '准备', currentIdx > 0 ? 'done' : currentIdx === 0 ? 'active' : 'pending'),
    step('think', '思考', currentIdx > 1 ? 'done' : currentIdx === 1 ? 'active' : 'pending'),
    step(
      'tool',
      '工具',
      !hasTools && currentIdx >= 2
        ? 'skipped'
        : currentIdx > 2
          ? 'done'
          : currentIdx === 2
            ? 'active'
            : 'pending',
    ),
    step('write', '输出', currentIdx === 3 ? 'active' : 'pending'),
  ];

  return {
    mode: 'running',
    headline,
    detail,
    steps,
  };
}
