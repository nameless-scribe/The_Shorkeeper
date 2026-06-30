import type { WorkspaceAttachment } from '@/shared/types';
import type { UiToolCall } from './ToolCallCard';

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
      return { icon: 'M', accent: 'bg-slate-500' };
    case 'csv':
      return { icon: 'C', accent: 'bg-teal-600' };
    default:
      return { icon: '📄', accent: 'bg-keeper-cyan/30' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function attachmentFromPath(relativePath: string, size = 0): WorkspaceAttachment {
  const normalized = relativePath.replace(/\\/g, '/');
  return {
    relativePath: normalized,
    originalName: normalized.split('/').pop() ?? normalized,
    size,
  };
}

function pathFromArgs(toolName: string, args: Record<string, unknown>): string | null {
  if (toolName === 'read_file' || toolName === 'read_xlsx' || toolName === 'write_file') {
    const path = args.path;
    return typeof path === 'string' && path.trim() ? path.trim() : null;
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

function pathsFromOutput(output: string): string[] {
  const paths: string[] = [];
  const patterns = [
    /已(?:写入|生成|转换)\s+([^\s（]+)/g,
    /→\s+([^\s（]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      const p = match[1]?.trim();
      if (p && !paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

/** 从单次工具调用提取可打开的工作区文件 */
export function extractFilesFromToolCall(tc: UiToolCall): WorkspaceAttachment[] {
  if (tc.status !== 'done' || !tc.result?.success) return [];

  const seen = new Set<string>();
  const files: WorkspaceAttachment[] = [];

  const push = (file: WorkspaceAttachment) => {
    const key = file.relativePath.replace(/\\/g, '/');
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ ...file, relativePath: key });
  };

  for (const artifact of tc.result.artifacts ?? []) {
    push(artifact);
  }

  if (isRecord(tc.args)) {
    const fromArgs = pathFromArgs(tc.name, tc.args);
    if (fromArgs) push(attachmentFromPath(fromArgs));
  }

  if (tc.result.output) {
    for (const p of pathsFromOutput(tc.result.output)) {
      push(attachmentFromPath(p));
    }
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
  let files = message.relatedFiles ?? [];

  for (const tc of message.toolCalls ?? []) {
    files = mergeAttachments(files, extractFilesFromToolCall(tc));
  }

  return files;
}

/** @deprecated use collectMessageFiles */
export function collectArtifactsFromToolCalls(toolCalls?: UiToolCall[]): WorkspaceAttachment[] {
  return collectMessageFiles({ toolCalls });
}
