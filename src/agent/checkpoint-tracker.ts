import fs from 'node:fs/promises';
import { resolveWorkspacePath } from '../tools/file/workspace-path';
import type { ToolResult } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import type { PermissionPolicy } from './types';
import { listDataSources, listDictionaryEntries, listMetrics } from '../db/repositories/datasources';
import { callDigest, digest, parseCheckpoint, CHECKPOINT_MAX_SEGMENTS, type RunCheckpoint } from './checkpoint-contract';

/** 只保存配置/字典的摘要，不连接业务数据库，不持久化凭据。 */
export function checkpointEnvironment(registry: ToolRegistry, policy: PermissionPolicy): string {
  const sources = listDataSources().map((source) => ({
    id: source.id, updatedAt: source.updatedAt,
    dictionary: listDictionaryEntries(source.id), metrics: listMetrics(source.id),
  }));
  return digest(JSON.stringify({ tools: registry.toOpenAITools(),
    contracts: registry.list().map((tool) => ({ name: tool.name, sideEffects: tool.sideEffects,
      requiresPermission: tool.requiresPermission, describeCall: tool.describeCall?.toString() })), policy, sources }));
}

async function fileHash(root: string, path: string): Promise<string> {
  const absolute = resolveWorkspacePath(root, path);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('检查点文件不可校验或超过 32MB');
  return digest(await fs.readFile(absolute));
}

export async function validateCheckpointFiles(checkpoint: RunCheckpoint, root: string, environment: string): Promise<void> {
  if (checkpoint.environment !== environment) throw new Error('工具、权限或数据源结构已变化，请重新核对任务');
  if (checkpoint.totals.segments >= CHECKPOINT_MAX_SEGMENTS) throw new Error('本任务已执行 10 段，请整理结果后重新确认任务范围');
  for (const file of checkpoint.files) {
    if (await fileHash(root, file.path) !== file.sha256) throw new Error('检查点引用的文件已变化，请重新核对结果');
  }
}

export class CheckpointTracker {
  private files = new Map<string, string>();
  private effects = new Set<string>();
  private answers: string[];
  private issue: string | undefined;
  constructor(private readonly root: string, private readonly previous?: RunCheckpoint) {
    for (const file of previous?.files ?? []) this.files.set(file.path, file.sha256);
    for (const effect of previous?.completedEffects ?? []) this.effects.add(effect);
    this.answers = [...previous?.answers ?? []];
  }

  blocks(name: string, rawArgs: string): boolean { return this.effects.has(callDigest(name, rawArgs)); }

  async before(args: unknown): Promise<void> {
    if (!args || typeof args !== 'object') return;
    for (const [key, value] of Object.entries(args)) {
      if (!/^(path|file_path|input_path|source_path)$/.test(key) || typeof value !== 'string') continue;
      try { this.files.set(value, await fileHash(this.root, value)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.issue = '有文件来源无法核验，不提供自动恢复'; }
    }
    if (this.files.size > 100) this.issue = '文件来源超过检查点容量';
  }

  async after(name: string, rawArgs: string, result: ToolResult, nonIdempotent: boolean, sideEffecting = nonIdempotent): Promise<void> {
    if (result.errorCategory === 'timeout' || result.errorCategory === 'cancelled') this.issue = '有工具超时或取消，需先人工核对执行结果';
    if (sideEffecting && !result.success) this.issue = '有副作用步骤失败，需先核对是否部分执行';
    if (nonIdempotent && result.success) this.effects.add(callDigest(name, rawArgs));
    if (name === 'ask_user' && result.success) this.answers.push(result.output);
    for (const artifact of result.artifacts ?? []) {
      try { this.files.set(artifact.relativePath, await fileHash(this.root, artifact.relativePath)); }
      catch { this.issue = '产物无法重新核验'; }
    }
  }

  snapshot(input: Omit<RunCheckpoint, 'version' | 'answers' | 'completedEffects' | 'files'>): RunCheckpoint {
    if (this.issue) throw new Error(this.issue);
    return parseCheckpoint(JSON.stringify({ ...input, version: 1,
      answers: this.answers, completedEffects: [...this.effects],
      files: [...this.files].map(([path, sha256]) => ({ path, sha256 })),
    }));
  }
}
