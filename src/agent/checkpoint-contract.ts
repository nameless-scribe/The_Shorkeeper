import { createHash } from 'node:crypto';
import { canonicalCallSignature } from './execution-limits';

/** 主进程内部格式；不含完整 prompt、原始工具参数或审批授权。 */
export interface RunCheckpoint {
  version: 1;
  rootRunId: string;
  goal: string;
  answers: string[];
  facts: string[];
  pending: string[];
  completedEffects: string[];
  files: Array<{ path: string; sha256: string }>;
  environment: string;
  totals: { rounds: number; toolCalls: number; tokens: number; activeMs: number; segments: number };
}

export const CHECKPOINT_MAX_BYTES = 100_000;
export const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60_000;
export const CHECKPOINT_MAX_SEGMENTS = 10;
export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function callDigest(name: string, args: string): string { return digest(canonicalCallSignature(name, args)); }

export function parseCheckpoint(raw: string): RunCheckpoint {
  if (Buffer.byteLength(raw) > CHECKPOINT_MAX_BYTES) throw new Error('检查点超过容量限制');
  const value: unknown = JSON.parse(raw);
  const record = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
  const text = (item: unknown, max: number): item is string => typeof item === 'string' && item.length <= max;
  const texts = (item: unknown, count: number, max: number): item is string[] => Array.isArray(item) && item.length <= count && item.every((entry) => text(entry, max));
  const hash = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  if (!record(value) || value.version !== 1 || !text(value.rootRunId, 200) || !text(value.goal, 16000)
      || !texts(value.answers, 40, 4000) || !texts(value.facts, 150, 2000) || !texts(value.pending, 100, 2000)
      || !texts(value.completedEffects, 1000, 64) || !value.completedEffects.every(hash)
      || !hash(value.environment) || !Array.isArray(value.files) || value.files.length > 100
      || !value.files.every((file) => record(file) && text(file.path, 1000) && hash(file.sha256))
      || !record(value.totals) || !['rounds', 'toolCalls', 'tokens', 'activeMs', 'segments'].every((key) => {
        const count = (value.totals as Record<string, unknown>)[key];
        return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
      })) throw new Error('检查点格式无效，不能继续');
  return value as unknown as RunCheckpoint;
}
