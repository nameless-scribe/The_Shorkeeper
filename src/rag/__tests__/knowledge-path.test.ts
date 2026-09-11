import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getKnowledgeDir, sanitizeKnowledgeFilename } from '../knowledge-path';

const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('sanitizeKnowledgeFilename', () => {
  it('rejects path traversal', () => {
    expect(() => sanitizeKnowledgeFilename('../../outside.md')).toThrow();
    expect(() => sanitizeKnowledgeFilename('../secret.md')).toThrow();
  });

  it('strips directory components', () => {
    expect(sanitizeKnowledgeFilename('subdir/notes.md')).toBe('notes.md');
  });

  it('sanitizes illegal characters', () => {
    expect(sanitizeKnowledgeFilename('bad<file>.md')).toBe('bad_file_.md');
  });

  it('rejects a knowledge directory symlink outside the workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-knowledge-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-knowledge-outside-'));
    temporaryRoots.push(root, outside);
    process.env.SHOREKEEPER_WORKSPACE_DIR = root;
    await fs.symlink(outside, path.join(root, 'knowledge'), 'junction');

    expect(() => getKnowledgeDir()).toThrow('路径越界');
  });
});
