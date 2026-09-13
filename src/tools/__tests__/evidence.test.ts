import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORKSPACE_WRITE_CONTRACT, READ_ONLY_CONTRACT } from '../contract';
import { checkArtifactEvidence, enforceToolEvidence } from '../evidence';
import { buildFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';

describe('tool completion evidence', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-evidence-'));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('attaches the read-back sha256 to artifacts produced by atomic writes', async () => {
    const artifact = await writeWorkspaceFileAtomically(
      workspace,
      'reports/a.md',
      (temporaryPath) => fs.writeFile(temporaryPath, '# hello', 'utf-8'),
    );
    expect(artifact.sha256).toBe(createHash('sha256').update('# hello').digest('hex'));
    expect(artifact.size).toBe(7);

    const rebuilt = await buildFileArtifact(workspace, 'reports/a.md');
    expect(rebuilt.sha256).toBe(artifact.sha256);
  });

  it('accepts artifacts that exist with matching size and digest', async () => {
    const artifact = await writeWorkspaceFileAtomically(
      workspace,
      'out.txt',
      (temporaryPath) => fs.writeFile(temporaryPath, 'content', 'utf-8'),
    );
    const result = await enforceToolEvidence(
      { success: true, output: '已生成', artifacts: [artifact] },
      WORKSPACE_WRITE_CONTRACT,
      workspace,
    );
    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({ evidenceVerified: true, evidenceArtifacts: 1 });
  });

  it('downgrades a claimed success when the artifact is missing, altered or absent', async () => {
    const missing = await enforceToolEvidence(
      { success: true, output: '声称完成', artifacts: [{ relativePath: 'ghost.md', originalName: 'ghost.md', size: 1 }] },
      WORKSPACE_WRITE_CONTRACT,
      workspace,
    );
    expect(missing.success).toBe(false);
    expect(missing.errorCategory).toBe('internal_error');
    expect(missing.error).toContain('产物不存在');

    const noArtifacts = await enforceToolEvidence(
      { success: true, output: '声称完成' },
      WORKSPACE_WRITE_CONTRACT,
      workspace,
    );
    expect(noArtifacts.success).toBe(false);
    expect(noArtifacts.error).toContain('没有任何产物');

    const artifact = await writeWorkspaceFileAtomically(
      workspace,
      'edited.txt',
      (temporaryPath) => fs.writeFile(temporaryPath, 'v1', 'utf-8'),
    );
    await fs.writeFile(path.join(workspace, 'edited.txt'), 'v2', 'utf-8');
    // Same size, different bytes: only detected when digest verification is requested.
    expect((await checkArtifactEvidence([artifact], workspace)).ok).toBe(true);
    const altered = await checkArtifactEvidence([artifact], workspace, { verifyDigest: true });
    expect(altered.ok).toBe(false);
    expect(altered.reason).toContain('摘要不一致');

    const escaped = await checkArtifactEvidence(
      [{ relativePath: '../outside.txt', originalName: 'outside.txt', size: 0 }],
      workspace,
    );
    expect(escaped.ok).toBe(false);
  });

  it('leaves failures and non-artifact contracts untouched', async () => {
    const failure = { success: false, output: '', error: '失败' };
    expect(await enforceToolEvidence(failure, WORKSPACE_WRITE_CONTRACT, workspace)).toBe(failure);
    const readOnly = { success: true, output: 'ok' };
    expect(await enforceToolEvidence(readOnly, READ_ONLY_CONTRACT, workspace)).toBe(readOnly);
  });
});
