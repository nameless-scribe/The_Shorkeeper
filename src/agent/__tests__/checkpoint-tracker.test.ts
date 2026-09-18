import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckpointTracker, validateCheckpointFiles } from '../checkpoint-tracker';
import { callDigest, parseCheckpoint } from '../checkpoint-contract';

describe('checkpoint evidence and replay guard', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-checkpoint-evidence-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const input = { rootRunId: 'root', goal: '处理文件', environment: 'a'.repeat(64), facts: [], pending: ['下一步'],
    totals: { rounds: 2, toolCalls: 3, tokens: 10000, activeMs: 1000, segments: 1 } };

  it('pins input versions and refuses changed or missing files and changed policy/source fingerprints', async () => {
    await fs.writeFile(path.join(root, 'source.txt'), 'v1');
    const tracker = new CheckpointTracker(root);
    await tracker.before({ path: 'source.txt' });
    const snapshot = tracker.snapshot(input);
    await expect(validateCheckpointFiles(snapshot, root, input.environment)).resolves.toBeUndefined();
    await expect(validateCheckpointFiles(snapshot, root, 'b'.repeat(64))).rejects.toThrow('已变化');
    await fs.writeFile(path.join(root, 'source.txt'), 'v2');
    await expect(validateCheckpointFiles(snapshot, root, input.environment)).rejects.toThrow('已变化');
    await fs.unlink(path.join(root, 'source.txt'));
    await expect(validateCheckpointFiles(snapshot, root, input.environment)).rejects.toThrow();
  });

  it('carries successful side-effect guards across segments without storing raw arguments', async () => {
    const tracker = new CheckpointTracker(root);
    await tracker.after('send', '{"secret":"private","to":"someone"}', { success: true, output: 'sent' }, true);
    const snapshot = tracker.snapshot(input);
    expect(JSON.stringify(snapshot)).not.toContain('private');
    const restored = new CheckpointTracker(root, snapshot);
    expect(restored.blocks('send', '{ "to": "someone", "secret": "private" }')).toBe(true);
    expect(snapshot.completedEffects).toEqual([callDigest('send', '{"secret":"private","to":"someone"}')]);
  });

  it('does not enable continuation after unknown outcome or a failed idempotent write', async () => {
    for (const [result, sideEffecting] of [
      [{ success: false, output: '', errorCategory: 'timeout' as const }, false],
      [{ success: false, output: '', errorCategory: 'internal_error' as const }, true],
    ] as const) {
      const tracker = new CheckpointTracker(root);
      await tracker.after('tool', '{}', result, false, sideEffecting);
      expect(() => tracker.snapshot(input)).toThrow();
    }
  });

  it('rejects invalid checkpoint shapes and unbounded continuation chains', async () => {
    expect(() => parseCheckpoint(JSON.stringify({ ...input, version: 99 }))).toThrow();
    const snapshot = new CheckpointTracker(root).snapshot({ ...input, totals: { ...input.totals, segments: 10 } });
    await expect(validateCheckpointFiles(snapshot, root, input.environment)).rejects.toThrow('10 段');
  });
});
