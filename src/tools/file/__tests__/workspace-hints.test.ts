import { describe, expect, it } from 'vitest';
import { normalizeFilenameForMatch } from '../workspace-hints';

describe('normalizeFilenameForMatch', () => {
  it('strips book title brackets for comparison', () => {
    expect(normalizeFilenameForMatch('《OA管理系统实施计划-V2》.md')).toBe(
      normalizeFilenameForMatch('OA管理系统实施计划-V2.md'),
    );
  });
});
