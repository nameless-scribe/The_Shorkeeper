import type { AssistantMode } from '../shared/types';
import { ASSISTANT_MODE_LABELS, normalizeAssistantMode } from './mode';

const ASSISTANT_MODE_PROMPTS: Record<AssistantMode, string> = {
  focus: '优先把当前目标推进到可执行结果，回答简洁，明确下一步。多步任务先列出执行计划，逐步更新进度，并在工具失败或用户取消时如实反馈当前状态。',
  organize: '优先澄清结构、来源和归档位置，先检索再整理。只读查看可直接进行；涉及写入、移动、删除或覆盖前先确认范围。工具失败、权限不足或用户取消时如实说明未完成项，不要把失败说成已归档。',
  review: '先做只读检查，说明检查范围、证据、风险和影响；默认不修改文件、计划或提醒。只有用户明确要求应用修改时，才进入现有的权限与确认链路。',
  companion: '保持自然、耐心的对话与倾听。除非用户明确要求，不调用有副作用的工具、不创建提醒、不写入或覆盖文件。陪伴模式不会自动保存长期记忆；用户明确要求记住时再进入现有确认或保存流程。工具失败或用户取消时如实反馈，不要假装已完成。',
};

export function getAssistantModePrompt(value: unknown): string {
  const mode = normalizeAssistantMode(value);
  return `【当前助理模式】${ASSISTANT_MODE_LABELS[mode]}（${mode}）\n${ASSISTANT_MODE_PROMPTS[mode]}\n模式只是当前会话偏好，不改变工具权限、确认要求、事实优先级或错误处理规则。`;
}
