import type { AssistantMode } from '../shared/types';

export const DEFAULT_ASSISTANT_MODE: AssistantMode = 'focus';

export const ASSISTANT_MODES: readonly AssistantMode[] = [
  'focus',
  'organize',
  'review',
  'companion',
];

export const ASSISTANT_MODE_LABELS: Record<AssistantMode, string> = {
  focus: '专注推进',
  organize: '整理归档',
  review: '审核检查',
  companion: '轻陪伴',
};

export const ASSISTANT_MODE_HINTS: Record<AssistantMode, string> = {
  focus: '推进当前任务，写入前仍会确认',
  organize: '先检索再整理，覆盖或删除前确认范围',
  review: '默认只读审核，不直接改文件或计划',
  companion: '轻陪伴，不自动记忆或产生副作用',
};

export function normalizeAssistantMode(value: unknown): AssistantMode {
  if (value === 'focus' || value === 'organize' || value === 'review' || value === 'companion') {
    return value;
  }
  return DEFAULT_ASSISTANT_MODE;
}

export function allowsAutoMemoryExtraction(value: unknown): boolean {
  return normalizeAssistantMode(value) !== 'companion';
}
