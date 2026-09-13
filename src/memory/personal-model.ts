import type {
  MemoryCandidateCategory,
  MemoryModelUsePolicy,
  MemoryProposedAction,
  MemorySensitivity,
  MemorySourceType,
  PersonalMemoryStatus,
  PersonalMemoryType,
} from '../shared/types';

export const PERSONAL_MEMORY_TYPES = [
  'identity',
  'preference',
  'relationship',
  'event',
  'goal',
  'habit',
  'procedure',
  'other',
] as const satisfies readonly PersonalMemoryType[];

export const PERSONAL_MEMORY_STATUSES = [
  'active',
  'disputed',
  'superseded',
  'expired',
  'rejected',
] as const satisfies readonly PersonalMemoryStatus[];

export const MEMORY_SENSITIVITIES = [
  'normal',
  'private',
  'sensitive',
] as const satisfies readonly MemorySensitivity[];

export const MEMORY_MODEL_USE_POLICIES = [
  'allow',
  'deny',
] as const satisfies readonly MemoryModelUsePolicy[];

export const MEMORY_PROPOSED_ACTIONS = [
  'create',
  'replace',
  'merge',
  'ignore',
] as const satisfies readonly MemoryProposedAction[];

export const MEMORY_SOURCE_TYPES = [
  'conversation',
  'user_edit',
  'document',
  'tool',
  'goal',
  'commitment',
  'legacy',
] as const satisfies readonly MemorySourceType[];

export function memoryTypeFromCandidateCategory(
  category: MemoryCandidateCategory,
): PersonalMemoryType {
  if (category === 'stable_preference') return 'preference';
  if (category === 'relationship') return 'relationship';
  return 'other';
}

/** P1.0 contract classifier. It is intentionally not wired into extraction until P1.2. */
export function classifyPersonalMemoryKey(memoryKey: string): PersonalMemoryType {
  const normalized = memoryKey.trim().toLowerCase();
  if (/^user\.(identity|profile|name|nickname)(\.|$)/.test(normalized)) return 'identity';
  if (/^user\.(preference|pref)(\.|$)/.test(normalized)) return 'preference';
  if (/^user\.relationship(\.|$)/.test(normalized)) return 'relationship';
  if (/^user\.(event|milestone)(\.|$)/.test(normalized)) return 'event';
  if (/^user\.goal(\.|$)/.test(normalized)) return 'goal';
  if (/^user\.(habit|routine|schedule)(\.|$)/.test(normalized)) return 'habit';
  if (/^user\.(procedure|workflow)(\.|$)/.test(normalized)) return 'procedure';
  return 'other';
}

export function clampMemoryConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
