import type { WorkspaceAttachment } from '@/shared/types';
import type { UiToolCall } from './ToolCallCard';

const WORKSPACE_FILE_PATTERN =
  /\.(md|markdown|txt|csv|json|xlsx|xls|docx|doc|pdf|yaml|yml|xml|html|htm|log|ini|py|ts|tsx|js|jsx)$/i;

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}M`;
}

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function fileTypeVisual(name: string): { icon: string; accent: string } {
  const ext = fileExtension(name);
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return { icon: 'X', accent: 'bg-emerald-600' };
    case 'docx':
    case 'doc':
      return { icon: 'W', accent: 'bg-blue-600' };
    case 'pdf':
      return { icon: 'P', accent: 'bg-red-600' };
    case 'md':
    case 'markdown':
      return { icon: 'M', accent: 'bg-slate-600' };
    case 'csv':
      return { icon: 'C', accent: 'bg-teal-600' };
    default:
      return { icon: '📄', accent: 'bg-keeper-cyan/25' };
  }
}

/** 仅接受带合法扩展名、像工作区相对路径的字符串 */
export function isLikelyWorkspaceFilePath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/').trim();
  if (!normalized || normalized.length > 280) return false;
  if (/[<>|*?《》]/.test(normalized)) return false;
  if (!WORKSPACE_FILE_PATTERN.test(normalized)) return false;
  const base = normalized.split('/').pop() ?? '';
  return base.length > 2 && !base.includes('(');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function attachmentFromPath(relativePath: string, size = 0): WorkspaceAttachment | null {
  if (!isLikelyWorkspaceFilePath(relativePath)) return null;
  const normalized = relativePath.replace(/\\/g, '/');
  return {
    relativePath: normalized,
    originalName: normalized.split('/').pop() ?? normalized,
    size,
  };
}

function pathFromArgs(toolName: string, args: Record<string, unknown>): string | null {
  if (
    toolName === 'read_file' ||
    toolName === 'read_xlsx' ||
    toolName === 'write_file' ||
    toolName === 'replace_text'
  ) {
    const path = args.path;
    return typeof path === 'string' && path.trim() ? path.trim() : null;
  }

  if (toolName === 'update_xlsx_cells') {
    const output = args.output_path;
    if (typeof output === 'string' && output.trim()) return output.trim();
    const source = args.source_path;
    return typeof source === 'string' && source.trim() ? source.trim() : null;
  }

  if (toolName === 'convert_to_markdown') {
    const out = args.output_path;
    if (typeof out === 'string' && out.trim()) return out.trim();
    const src = args.source_path;
    if (typeof src === 'string' && src.trim()) {
      return `${src.replace(/\\/g, '/').replace(/\.[^.]+$/, '')}.md`;
    }
    return null;
  }

  if (toolName === 'travel_plan') {
    const out = args.output_path;
    return typeof out === 'string' && out.trim() ? out.trim() : null;
  }

  const writeTools = new Set(['gen_markdown', 'gen_docx', 'gen_xlsx', 'gen_pdf']);
  if (writeTools.has(toolName)) {
    const path = args.path;
    return typeof path === 'string' && path.trim() ? path.trim() : null;
  }

  return null;
}

/** 从单次工具调用提取可打开的工作区文件（仅 artifacts + 工具参数 path，不解析文件正文） */
export function extractFilesFromToolCall(tc: UiToolCall): WorkspaceAttachment[] {
  if (tc.status !== 'done' || !tc.result?.success) return [];

  const seen = new Set<string>();
  const files: WorkspaceAttachment[] = [];

  const push = (file: WorkspaceAttachment | null) => {
    if (!file) return;
    const key = file.relativePath.replace(/\\/g, '/');
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const artifact of tc.result.artifacts ?? []) {
    if (isLikelyWorkspaceFilePath(artifact.relativePath)) {
      push({ ...artifact, relativePath: artifact.relativePath.replace(/\\/g, '/') });
    }
  }

  if (isRecord(tc.args)) {
    const fromArgs = pathFromArgs(tc.name, tc.args);
    if (fromArgs) push(attachmentFromPath(fromArgs));
  }

  return files;
}

export function mergeAttachments(
  base: WorkspaceAttachment[] | undefined,
  extra: WorkspaceAttachment[],
): WorkspaceAttachment[] {
  const seen = new Set<string>();
  const merged: WorkspaceAttachment[] = [];

  for (const file of [...(base ?? []), ...extra]) {
    const key = file.relativePath.replace(/\\/g, '/');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...file, relativePath: key });
  }

  return merged;
}

export function collectMessageFiles(message: {
  toolCalls?: UiToolCall[];
  relatedFiles?: WorkspaceAttachment[];
}): WorkspaceAttachment[] {
  let files = (message.relatedFiles ?? []).filter((f) =>
    isLikelyWorkspaceFilePath(f.relativePath),
  );

  for (const tc of message.toolCalls ?? []) {
    files = mergeAttachments(files, extractFilesFromToolCall(tc));
  }

  return files;
}

/** @deprecated use collectMessageFiles */
export function collectArtifactsFromToolCalls(toolCalls?: UiToolCall[]): WorkspaceAttachment[] {
  return collectMessageFiles({ toolCalls });
}
