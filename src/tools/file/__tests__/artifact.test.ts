import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeWorkspaceFileAtomically } from '../artifact';

describe('writeWorkspaceFileAtomically', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the previous file when generation fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-atomic-'));
    const target = path.join(root, 'report.md');
    await fs.writeFile(target, 'old content', 'utf8');

    await expect(
      writeWorkspaceFileAtomically(root, 'report.md', async (temporaryPath) => {
        await fs.writeFile(temporaryPath, 'partial content', 'utf8');
        throw new Error('generator failed');
      }),
    ).rejects.toThrow('generator failed');

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('old content');
    await expect(fs.readdir(root)).resolves.toEqual(['report.md']);
  });

  it('commits a valid artifact and replaces the previous file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-atomic-'));
    const target = path.join(root, 'report.md');
    await fs.writeFile(target, 'old content', 'utf8');

    const artifact = await writeWorkspaceFileAtomically(
      root,
      'report.md',
      (temporaryPath) => fs.writeFile(temporaryPath, 'new content', 'utf8'),
    );

    expect(artifact.relativePath).toBe('report.md');
    expect(artifact.size).toBe(Buffer.byteLength('new content'));
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('new content');
    await expect(fs.readdir(root)).resolves.toEqual(['report.md']);
  });

  it('keeps the backup when automatic restoration fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-atomic-'));
    const target = path.join(root, 'report.md');
    await fs.writeFile(target, 'old content', 'utf8');

    const originalRename = fs.rename.bind(fs);
    let renameAttempt = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      renameAttempt += 1;
      if (renameAttempt >= 2) {
        throw Object.assign(new Error('rename blocked'), { code: 'EACCES' });
      }
      return originalRename(from, to);
    });

    await expect(
      writeWorkspaceFileAtomically(
        root,
        'report.md',
        (temporaryPath) => fs.writeFile(temporaryPath, 'new content', 'utf8'),
      ),
    ).rejects.toThrow(/恢复备份已保留/);

    const remaining = await fs.readdir(root);
    const backup = remaining.find((name) => name.endsWith('.bak'));
    expect(backup).toBeDefined();
    await expect(fs.readFile(path.join(root, backup!), 'utf8')).resolves.toBe('old content');
  });

  it('retains a durable backup and verifies important file replacement', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-atomic-'));
    const importantDir = path.join(root, 'important');
    await fs.mkdir(importantDir);
    await fs.writeFile(path.join(importantDir, 'plan.md'), 'old plan', 'utf8');

    await writeWorkspaceFileAtomically(
      root,
      'important/plan.md',
      (temporaryPath) => fs.writeFile(temporaryPath, 'new plan', 'utf8'),
    );

    await expect(fs.readFile(path.join(importantDir, 'plan.md'), 'utf8')).resolves.toBe('new plan');
    const backups = await fs.readdir(path.join(root, '.shorekeeper-backups'));
    expect(backups).toHaveLength(1);
    await expect(
      fs.readFile(path.join(root, '.shorekeeper-backups', backups[0]), 'utf8'),
    ).resolves.toBe('old plan');
  });

  it('rejects a backup directory symlink that escapes the workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-atomic-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-outside-'));
    const target = path.join(root, 'important', 'plan.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'old plan', 'utf8');
    await fs.symlink(outside, path.join(root, '.shorekeeper-backups'), 'junction');

    await expect(
      writeWorkspaceFileAtomically(
        root,
        'important/plan.md',
        (temporaryPath) => fs.writeFile(temporaryPath, 'new plan', 'utf8'),
      ),
    ).rejects.toThrow('路径越界');

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('old plan');
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });
});
