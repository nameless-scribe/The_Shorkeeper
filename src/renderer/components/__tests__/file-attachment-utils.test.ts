import { describe, expect, it } from 'vitest';
import { extractFilesFromToolCall } from '../../components/file-attachment-utils';
import type { UiToolCall } from '../../components/ToolCallCard';

describe('extractFilesFromToolCall', () => {
  it('extracts path from successful read_file args', () => {
    const tc: UiToolCall = {
      callId: '1',
      name: 'read_file',
      args: { path: 'OA管理系统实施计划-V2.md' },
      status: 'done',
      result: { success: true, output: '# title\n...' },
    };
    const files = extractFilesFromToolCall(tc);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('OA管理系统实施计划-V2.md');
  });

  it('extracts path from write_file output', () => {
    const tc: UiToolCall = {
      callId: '2',
      name: 'write_file',
      args: { path: 'out.md', content: 'x' },
      status: 'done',
      result: { success: true, output: '已写入 out.md（100 字节）' },
    };
    const files = extractFilesFromToolCall(tc);
    expect(files.some((f) => f.relativePath === 'out.md')).toBe(true);
  });
});
