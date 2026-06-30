import { describe, expect, it } from 'vitest';
import {
  extractFilesFromToolCall,
  isLikelyWorkspaceFilePath,
} from '../../components/file-attachment-utils';
import type { UiToolCall } from '../../components/ToolCallCard';

describe('isLikelyWorkspaceFilePath', () => {
  it('accepts md paths', () => {
    expect(isLikelyWorkspaceFilePath('OA管理系统实施计划-V2.md')).toBe(true);
  });

  it('rejects task labels with parentheses', () => {
    expect(isLikelyWorkspaceFilePath('Service(SQL)')).toBe(false);
    expect(isLikelyWorkspaceFilePath('路由(zod校验)')).toBe(false);
  });
});

describe('extractFilesFromToolCall', () => {
  it('extracts path from successful read_file args only', () => {
    const tc: UiToolCall = {
      callId: '1',
      name: 'read_file',
      args: { path: 'OA管理系统实施计划-V2.md' },
      status: 'done',
      result: {
        success: true,
        output: '### P3.1 岗位管理\n- 后端：Service(SQL) → 路由(zod校验)',
      },
    };
    const files = extractFilesFromToolCall(tc);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('OA管理系统实施计划-V2.md');
  });

  it('extracts path from write_file args', () => {
    const tc: UiToolCall = {
      callId: '2',
      name: 'write_file',
      args: { path: 'out.md', content: 'x' },
      status: 'done',
      result: { success: true, output: '已写入 out.md（100 字节）' },
    };
    const files = extractFilesFromToolCall(tc);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('out.md');
  });
});
