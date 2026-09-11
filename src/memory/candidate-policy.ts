import type {
  MemoryCandidateCategory,
  MemoryCandidateDecision,
} from '../shared/types';

export const MEMORY_CANDIDATE_CONFIDENCE_THRESHOLD = 0.85;
export const MEMORY_CANDIDATE_MAX_KEY_LENGTH = 120;
export const MEMORY_CANDIDATE_MAX_CONTENT_LENGTH = 500;

export interface MemoryCandidateDraft {
  key: string;
  content: string;
  confidence: number;
  reason: string;
}

export interface MemoryCandidateEvaluation extends MemoryCandidateDraft {
  category: MemoryCandidateCategory;
  decision: MemoryCandidateDecision;
}

const MEMORY_KEY_PATTERN = /^user\.(nickname|preference|schedule|habit)(?:\.[a-z0-9_]+)*$/;
const RELATIONSHIP_KEY_PATTERN = /^user\.relationship(?:\.[a-z0-9_]+)*$/;
const OTHER_KEY_PATTERN = /^user\.other(?:\.[a-z0-9_]+)*$/;
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|api[_-]?key|身份证|银行卡|卡号)/i;
const SENSITIVE_CONTENT_PATTERN = /(密码|口令|验证码|身份证|银行卡|卡号|token|secret|private key)/i;

export function classifyMemoryKey(key: string): MemoryCandidateCategory | null {
  if (MEMORY_KEY_PATTERN.test(key)) return 'stable_preference';
  if (RELATIONSHIP_KEY_PATTERN.test(key)) return 'relationship';
  if (OTHER_KEY_PATTERN.test(key)) return 'other';
  return null;
}

export function clampMemoryConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.55;
  return Math.max(0, Math.min(1, value));
}

export function evaluateMemoryCandidate(draft: MemoryCandidateDraft): MemoryCandidateEvaluation {
  const key = draft.key.trim();
  const content = draft.content.trim();
  const confidence = clampMemoryConfidence(draft.confidence);
  const reason = draft.reason.trim() || '本轮对话中提取的用户事实';
  const category = classifyMemoryKey(key);

  if (
    !category ||
    key.length > MEMORY_CANDIDATE_MAX_KEY_LENGTH ||
    content.length === 0 ||
    content.length > MEMORY_CANDIDATE_MAX_CONTENT_LENGTH
  ) {
    return { key, content, confidence, reason, category: 'other', decision: 'deny' };
  }

  if (SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_CONTENT_PATTERN.test(content)) {
    return { key, content, confidence, reason, category, decision: 'confirm' };
  }

  const decision = category === 'stable_preference' &&
    confidence >= MEMORY_CANDIDATE_CONFIDENCE_THRESHOLD
    ? 'silent'
    : 'confirm';
  return { key, content, confidence, reason, category, decision };
}
