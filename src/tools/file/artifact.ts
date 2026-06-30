import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceAttachment } from '../../shared/types';
import type { ToolResult } from '../types';
import { resolveWorkspacePath } from './workspace-path';

export async function buildFileArtifact(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceAttachment> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(absolute);
  return {
    relativePath: relativePath.replace(/\\/g, '/'),
    originalName: path.basename(relativePath),
    size: stat.size,
  };
}

export function withFileArtifact(
  result: ToolResult,
  artifact: WorkspaceAttachment,
): ToolResult {
  return { ...result, artifacts: [artifact] };
}
