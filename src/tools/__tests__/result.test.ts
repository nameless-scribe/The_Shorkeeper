import { describe, expect, it } from 'vitest';
import {
  classifyToolError,
  createToolError,
  normalizeToolResult,
} from '../result';

describe('tool result contract', () => {
  it('classifies stable error categories before generic internal errors', () => {
    expect(classifyToolError('路径越界：不允许访问工作区外文件')).toBe('path_out_of_scope');
    expect(classifyToolError('权限被拒绝: write_file')).toBe('permission_denied');
    expect(classifyToolError('请求超时')).toBe('timeout');
    expect(classifyToolError('HTTP 503')).toBe('external_service_failure');
    expect(classifyToolError('工具内部失败')).toBe('internal_error');
  });

  it('normalizes successful results without inventing an error', () => {
    expect(normalizeToolResult({
      success: true,
      output: '完成',
      metadata: { changed: true },
    })).toEqual({
      success: true,
      output: '完成',
      metadata: { changed: true },
    });
  });

  it('preserves a structured dry-run preview', () => {
    const preview = {
      kind: 'text-diff' as const,
      target: 'note.txt',
      summary: '覆盖文件',
      revision: 'sha256:test:1',
      before: 'a',
      after: 'b',
    };
    expect(normalizeToolResult({ success: true, output: '预览', preview })).toEqual({
      success: true,
      output: '预览',
      preview,
    });
  });

  it('adds a category to legacy failed results and preserves artifacts', () => {
    const artifact = {
      relativePath: 'report.md',
      originalName: 'report.md',
      size: 12,
    };
    expect(normalizeToolResult({
      success: false,
      output: '',
      error: '用户拒绝了此操作',
      artifacts: [artifact],
    })).toEqual({
      success: false,
      output: '',
      error: '用户拒绝了此操作',
      errorCategory: 'permission_denied',
      artifacts: [artifact],
    });
  });

  it('converts malformed tool output into an internal error', () => {
    expect(createToolError('工具执行超时', 'timeout')).toEqual({
      success: false,
      output: '',
      error: '工具执行超时',
      errorCategory: 'timeout',
    });
    expect(normalizeToolResult(null)).toEqual({
      success: false,
      output: '',
      error: '工具执行失败',
      errorCategory: 'internal_error',
    });
  });
});
