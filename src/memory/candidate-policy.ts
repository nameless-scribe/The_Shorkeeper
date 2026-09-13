import type {
  MemoryCandidateCategory,
  MemoryCandidateDecision,
  MemoryModelUsePolicy,
  MemorySensitivity,
  PersonalMemoryType,
} from '../shared/types';
import {
  MEMORY_MODEL_USE_POLICIES,
  MEMORY_SENSITIVITIES,
  classifyPersonalMemoryKey,
} from './personal-model';

export const MEMORY_CANDIDATE_CONFIDENCE_THRESHOLD = 0.85;
export const MEMORY_CANDIDATE_MAX_KEY_LENGTH = 120;
export const MEMORY_CANDIDATE_MAX_CONTENT_LENGTH = 500;

export interface MemoryCandidateDraft {
  key: string;
  content: string;
  confidence: number;
  reason: string;
  memoryType?: unknown;
  sensitivity?: unknown;
  modelUsePolicy?: unknown;
  validFrom?: number | null;
  expiresAt?: number | null;
}

export interface MemoryCandidateEvaluation extends MemoryCandidateDraft {
  category: MemoryCandidateCategory;
  memoryType: PersonalMemoryType;
  sensitivity: MemorySensitivity;
  modelUsePolicy: MemoryModelUsePolicy;
  decision: MemoryCandidateDecision;
}

const VALID_KEY_PATTERN = /^user\.(?:[a-z0-9_]+)(?:\.[a-z0-9_]+)*$/;
const CREDENTIAL_KEY_PATTERN = /(?:password|passwd|credential|secret|token|api[_-]?key|验证码|身份证|银行卡|卡号|(?:^|[._-])pin(?:$|[._-]))/i;
const CREDENTIAL_CONTENT_PATTERN = /(密码|口令|验证码|身份证号?|银行卡号?|卡号|access[ _-]?token|api[ _-]?key|private key|密钥|\bpin\b)/i;
const HEALTH_OR_FINANCE_PATTERN = /(诊断|病史|治疗|用药|过敏|疾病|病症|收入|工资|负债|债务|资产|账户余额)/i;

function isValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function categoryFromMemoryType(type: PersonalMemoryType): MemoryCandidateCategory {
  if (type === 'relationship') return 'relationship';
  if (type === 'identity' || type === 'preference' || type === 'habit' || type === 'procedure') {
    return 'stable_preference';
  }
  return 'other';
}

/** 兼容旧调用方；P1.2 的真实分类由 memoryType 承载。 */
export function classifyMemoryKey(key: string): MemoryCandidateCategory | null {
  const normalized = key.trim().toLowerCase();
  if (!VALID_KEY_PATTERN.test(normalized)) return null;
  return categoryFromMemoryType(classifyPersonalMemoryKey(normalized));
}

export function clampMemoryConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.55;
  return Math.max(0, Math.min(1, value));
}

export function isCredentialLikeMemory(key: string, content: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key) || CREDENTIAL_CONTENT_PATTERN.test(content);
}

function resolveMemoryType(key: string): PersonalMemoryType {
  // key 是稳定协议；模型声明只用于审计，不能覆盖 key 或让 user.other 重新进入新提取。
  return classifyPersonalMemoryKey(key);
}

function resolveSensitivity(
  type: PersonalMemoryType,
  content: string,
  supplied: unknown,
): MemorySensitivity {
  if (HEALTH_OR_FINANCE_PATTERN.test(content)) return 'sensitive';
  if (isValue(MEMORY_SENSITIVITIES, supplied)) return supplied;
  if (type === 'relationship' || type === 'event') return 'private';
  return 'normal';
}

export function evaluateMemoryCandidate(draft: MemoryCandidateDraft): MemoryCandidateEvaluation {
  const key = draft.key.trim().toLowerCase();
  const content = draft.content.trim();
  const confidence = clampMemoryConfidence(draft.confidence);
  const reason = draft.reason.trim() || '本轮对话中提取的用户事实';
  const category = classifyMemoryKey(key);
  const memoryType = resolveMemoryType(key);
  const sensitivity = resolveSensitivity(memoryType, content, draft.sensitivity);
  const suppliedPolicy = isValue(MEMORY_MODEL_USE_POLICIES, draft.modelUsePolicy)
    ? draft.modelUsePolicy
    : 'allow';
  const modelUsePolicy: MemoryModelUsePolicy = sensitivity === 'sensitive'
    ? 'deny'
    : suppliedPolicy;

  const base = {
    ...draft,
    key,
    content,
    confidence,
    reason,
    category: category ?? 'other' as MemoryCandidateCategory,
    memoryType,
    sensitivity,
    modelUsePolicy,
  };

  if (
    !category ||
    key.length > MEMORY_CANDIDATE_MAX_KEY_LENGTH ||
    content.length === 0 ||
    content.length > MEMORY_CANDIDATE_MAX_CONTENT_LENGTH ||
    memoryType === 'other'
  ) {
    return { ...base, decision: 'deny' };
  }

  // 凭据类信息不进入候选，也不允许用户误确认保存。
  if (isCredentialLikeMemory(key, content)) {
    return { ...base, sensitivity: 'sensitive', modelUsePolicy: 'deny', decision: 'deny' };
  }

  if (
    memoryType === 'identity' ||
    memoryType === 'relationship' ||
    memoryType === 'event' ||
    memoryType === 'goal' ||
    sensitivity !== 'normal' ||
    modelUsePolicy === 'deny' ||
    confidence < MEMORY_CANDIDATE_CONFIDENCE_THRESHOLD
  ) {
    return { ...base, decision: 'confirm' };
  }

  return { ...base, decision: 'silent' };
}

export type MemoryFactRelation = 'duplicate' | 'supplement' | 'conflict' | 'new';

function normalizeFactContent(value: string): string {
  return value.trim().toLowerCase().replace(/[\s，。！？、,.!?;；:："'“”‘’（）()]/g, '');
}

/** 确定性第一层；语义模型不得绕过 same-key 冲突确认。 */
export function assessMemoryFactRelation(
  newKey: string,
  newContent: string,
  existingKey: string,
  existingContent: string,
): MemoryFactRelation {
  const next = normalizeFactContent(newContent);
  const current = normalizeFactContent(existingContent);
  if (!next || !current) return 'new';
  if (next === current || current.includes(next)) return 'duplicate';
  if (next.includes(current)) return newKey === existingKey ? 'supplement' : 'duplicate';
  return newKey === existingKey ? 'conflict' : 'new';
}
