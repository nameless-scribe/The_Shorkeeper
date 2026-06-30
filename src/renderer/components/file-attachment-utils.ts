import type { WorkspaceAttachment } from '@/shared/types';
import type { UiToolCall } from './ToolCallCard';

export function formatFileSize(bytes: number): string {
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

export function collectArtifactsFromToolCalls(toolCalls?: UiToolCall[]): WorkspaceAttachment[] {
  const seen = new Set<string>();
  const artifacts: WorkspaceAttachment[] = [];

  for (const tc of toolCalls ?? []) {
    if (tc.status !== 'done' || !tc.result?.success) continue;
    for (const artifact of tc.result.artifacts ?? []) {
      if (seen.has(artifact.relativePath)) continue;
      seen.add(artifact.relativePath);
      artifacts.push(artifact);
    }
  }

  return artifacts;
}
