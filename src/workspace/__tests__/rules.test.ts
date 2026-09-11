import { describe, expect, it } from 'vitest';
import {
  buildGeneratedWorkspacePath,
  isGeneratedWorkspacePath,
  isImportantWorkspacePath,
} from '../rules';

describe('workspace file rules', () => {
  it('recognizes protected and generated workspace areas', () => {
    expect(isImportantWorkspacePath('important/plan.md')).toBe(true);
    expect(isImportantWorkspacePath('reports/plan.md')).toBe(false);
    expect(isGeneratedWorkspacePath('reports/plan.md')).toBe(true);
    expect(isGeneratedWorkspacePath('notes/plan.md')).toBe(false);
  });

  it('builds stable, sanitized generated filenames', () => {
    expect(buildGeneratedWorkspacePath('report', '季度 / 汇总', '.md'))
      .toMatch(/^reports\/\d{4}-\d{2}-\d{2}-季度-汇总\.md$/);
  });
});
