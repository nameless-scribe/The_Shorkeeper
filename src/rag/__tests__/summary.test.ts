import { describe, expect, it } from 'vitest';
import { generateDocumentSummary } from '../summary';

describe('generateDocumentSummary', () => {
  it('builds summary from title and first paragraph', () => {
    const text = `# 需求规格说明书

产品面向企业用户，支持登录与权限管理。

## 登录流程
用户登录支持手机号验证码。`;

    const { summary, outline } = generateDocumentSummary(text, '需求规格说明书.md');
    expect(summary).toContain('需求规格说明书');
    expect(summary.length).toBeLessThanOrEqual(120);

    const headings = JSON.parse(outline) as string[];
    expect(headings).toContain('需求规格说明书');
    expect(headings).toContain('登录流程');
  });

  it('falls back to filename when text is empty-ish', () => {
    const { summary } = generateDocumentSummary('   ', 'OA流程.md');
    expect(summary).toContain('OA流程');
  });
});
