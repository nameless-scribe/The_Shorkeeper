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

/** 工作区上传：Office / 表格（需专用工具读取） */
export const WORKSPACE_OFFICE_EXTENSIONS = ['.doc', '.docx', '.xls', '.xlsx'] as const;

export const WORKSPACE_IMPORT_EXTENSIONS = new Set<string>([
  ...WORKSPACE_TEXT_EXTENSIONS,
  ...WORKSPACE_OFFICE_EXTENSIONS,
]);

export const MAX_WORKSPACE_IMPORT_BYTES = 20 * 1024 * 1024;

export function stripExtensionDot(ext: string): string {
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

export interface WorkspaceDialogFilter {
  name: string;
  extensions: string[];
}

export const WORKSPACE_PICK_DIALOG_FILTERS: WorkspaceDialogFilter[] = [
  {
    name: 'Office 与表格',
    extensions: WORKSPACE_OFFICE_EXTENSIONS.map(stripExtensionDot),
  },
  {
    name: '文本与代码',
    extensions: WORKSPACE_TEXT_EXTENSIONS.map(stripExtensionDot),
  },
  { name: '所有文件', extensions: ['*'] },
];

export type WorkspaceFileToolHint = 'read_file' | 'read_xlsx' | 'convert_to_markdown';

export function workspaceFileToolHint(ext: string): WorkspaceFileToolHint {
  const normalized = ext.toLowerCase();
  if (normalized === '.xlsx' || normalized === '.xls') return 'read_xlsx';
  if (normalized === '.doc' || normalized === '.docx') return 'convert_to_markdown';
  return 'read_file';
}

export function workspaceFileToolHintLabel(hint: WorkspaceFileToolHint): string {
  switch (hint) {
    case 'read_xlsx':
      return 'read_xlsx';
    case 'convert_to_markdown':
      return 'convert_to_markdown';
    default:
      return 'read_file';
  }
}
