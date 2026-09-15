import { AUDIO_EXTENSIONS, MAX_AUDIO_BYTES } from '../voice/asr-contract';

/** 工作区上传：文本 / 代码类 */
export const WORKSPACE_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.sql',
  '.ini',
  '.rtf',
] as const;

/** 工作区上传：Office / PDF / 表格（需专用工具读取；PDF 只读文字层，扫描件会明确报错） */
export const WORKSPACE_OFFICE_EXTENSIONS = ['.doc', '.docx', '.pdf', '.xls', '.xlsx'] as const;

/**
 * 工作区上传：录音。白名单直接取自转写契约——能上传的就是能转写的，
 * 不在这里另维护一份列表。它**不并入** WORKSPACE_IMPORT_EXTENSIONS：
 * 录音不是"可读内容"，上下文构建与大小上限都要分开处理。
 */
export const WORKSPACE_AUDIO_EXTENSIONS = new Set<string>(AUDIO_EXTENSIONS);

export const WORKSPACE_IMPORT_EXTENSIONS = new Set<string>([
  ...WORKSPACE_TEXT_EXTENSIONS,
  ...WORKSPACE_OFFICE_EXTENSIONS,
]);

export const MAX_WORKSPACE_IMPORT_BYTES = 20 * 1024 * 1024;
/** 录音单独设上限，与转写服务的硬上限一致，不受 20MB 文档上限约束 */
export const MAX_WORKSPACE_AUDIO_IMPORT_BYTES = MAX_AUDIO_BYTES;

export type WorkspaceAttachmentKind = 'text' | 'office' | 'audio';

export function classifyWorkspaceFile(ext: string): WorkspaceAttachmentKind {
  const normalized = ext.toLowerCase();
  if (WORKSPACE_AUDIO_EXTENSIONS.has(normalized)) return 'audio';
  if ((WORKSPACE_OFFICE_EXTENSIONS as readonly string[]).includes(normalized)) return 'office';
  return 'text';
}

export function isWorkspaceImportableExtension(ext: string): boolean {
  const normalized = ext.toLowerCase();
  return WORKSPACE_IMPORT_EXTENSIONS.has(normalized) || WORKSPACE_AUDIO_EXTENSIONS.has(normalized);
}

export function workspaceImportLimitBytes(kind: WorkspaceAttachmentKind): number {
  return kind === 'audio' ? MAX_WORKSPACE_AUDIO_IMPORT_BYTES : MAX_WORKSPACE_IMPORT_BYTES;
}

export function stripExtensionDot(ext: string): string {
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

export interface WorkspaceDialogFilter {
  name: string;
  extensions: string[];
}

export const WORKSPACE_PICK_DIALOG_FILTERS: WorkspaceDialogFilter[] = [
  {
    name: 'Office、PDF 与表格',
    extensions: WORKSPACE_OFFICE_EXTENSIONS.map(stripExtensionDot),
  },
  {
    name: '文本与代码',
    extensions: WORKSPACE_TEXT_EXTENSIONS.map(stripExtensionDot),
  },
  {
    name: '录音',
    extensions: AUDIO_EXTENSIONS.map(stripExtensionDot),
  },
  { name: '所有文件', extensions: ['*'] },
];

export type WorkspaceFileToolHint = 'read_file' | 'read_xlsx' | 'convert_to_markdown' | 'transcribe_audio';

export function workspaceFileToolHint(ext: string): WorkspaceFileToolHint {
  const normalized = ext.toLowerCase();
  if (WORKSPACE_AUDIO_EXTENSIONS.has(normalized)) return 'transcribe_audio';
  if (normalized === '.xlsx' || normalized === '.xls') return 'read_xlsx';
  if (normalized === '.doc' || normalized === '.docx' || normalized === '.pdf') return 'convert_to_markdown';
  return 'read_file';
}

export function workspaceFileToolHintLabel(hint: WorkspaceFileToolHint): string {
  switch (hint) {
    case 'read_xlsx':
      return 'read_xlsx';
    case 'convert_to_markdown':
      return 'convert_to_markdown';
    case 'transcribe_audio':
      return 'transcribe_audio';
    default:
      return 'read_file';
  }
}
