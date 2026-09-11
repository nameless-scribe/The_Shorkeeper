import type { AssistantMode } from '../shared/types';

export type AssistantScenarioToolExpectation = 'none' | 'readonly' | 'confirm_write';

export interface AssistantScenarioContract {
  id: string;
  title: string;
  mode: AssistantMode;
  allowsSideEffects: boolean;
  requiresConfirmation: boolean;
  autoExtractMemory: boolean;
  expectedTools: AssistantScenarioToolExpectation;
  failureHint: string;
}

/**
 * S5.0 固定场景基线。模式只表达工作倾向，不改变 S3 权限。
 */
export const ASSISTANT_SCENARIOS: readonly AssistantScenarioContract[] = [
  {
    id: 'casual_chat',
    title: '普通闲聊',
    mode: 'companion',
    allowsSideEffects: false,
    requiresConfirmation: false,
    autoExtractMemory: false,
    expectedTools: 'none',
    failureHint: '陪伴对话失败时只说明原因，不补做写入或提醒',
  },
  {
    id: 'multi_step_task',
    title: '推进多步任务',
    mode: 'focus',
    allowsSideEffects: true,
    requiresConfirmation: true,
    autoExtractMemory: true,
    expectedTools: 'confirm_write',
    failureHint: '工具失败或取消后保留已完成步骤，不把失败说成已完成',
  },
  {
    id: 'workspace_organize',
    title: '整理工作区',
    mode: 'organize',
    allowsSideEffects: true,
    requiresConfirmation: true,
    autoExtractMemory: true,
    expectedTools: 'confirm_write',
    failureHint: '归档失败时说明未完成项，不覆盖已有文件',
  },
  {
    id: 'knowledge_qa',
    title: '知识库问答',
    mode: 'organize',
    allowsSideEffects: false,
    requiresConfirmation: false,
    autoExtractMemory: true,
    expectedTools: 'readonly',
    failureHint: '检索失败时承认资料不足，不编造来源',
  },
  {
    id: 'review_plan',
    title: '审核计划',
    mode: 'review',
    allowsSideEffects: false,
    requiresConfirmation: false,
    autoExtractMemory: true,
    expectedTools: 'readonly',
    failureHint: '默认只读；没有明确授权时不修改计划或文件',
  },
  {
    id: 'create_reminder',
    title: '创建提醒',
    mode: 'focus',
    allowsSideEffects: true,
    requiresConfirmation: true,
    autoExtractMemory: true,
    expectedTools: 'confirm_write',
    failureHint: '权限不足或用户拒绝时不创建提醒',
  },
];

export function getAssistantScenario(id: string): AssistantScenarioContract | undefined {
  return ASSISTANT_SCENARIOS.find((scenario) => scenario.id === id);
}
