import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../markdown-ast';
import {
  escapeHtml,
  renderInlineHtml,
  renderMarkdownBodyHtml,
  renderPrintableHtmlDocument,
} from '../markdown-to-html';

describe('markdown → printable HTML', () => {
  it('escapes every text node so model output can never inject markup', () => {
    const doc = parseMarkdown('<script>alert(1)</script> & "引号" **<b>**\n\n| <th> | a |\n| --- | --- |\n| <td> | b |');
    const html = renderMarkdownBodyHtml(doc);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;引号&quot; <strong>&lt;b&gt;</strong>');
    expect(html).toContain('<th>&lt;th&gt;</th>');
    expect(html).toContain('<td>&lt;td&gt;</td>');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders headings, nested lists, tables, code and page breaks', () => {
    const html = renderMarkdownBodyHtml(
      parseMarkdown('## 标题\n\n- 甲\n  1. 甲一\n- 乙\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n---\n\n`code` 与 *斜体*'),
    );
    expect(html).toContain('<h2>标题</h2>');
    expect(html).toContain('<ul><li>甲<ol><li>甲一</li></ol></li><li>乙</li></ul>');
    expect(html).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain('<p><code>code</code> 与 <em>斜体</em></p>');
  });

  it('turns soft breaks into <br>', () => {
    expect(renderInlineHtml(parseInline('一\n二'))).toBe('一<br>二');
  });

  it('wraps the body in a complete document with the title as the first heading', () => {
    const html = renderPrintableHtmlDocument({ title: '季度<报告>', document: parseMarkdown('正文') });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>季度&lt;报告&gt;</title>');
    expect(html).toContain('<h1 class="doc-title">季度&lt;报告&gt;</h1>');
    expect(html).toContain('<p>正文</p>');
    expect(html).toContain('Microsoft YaHei');
    expect(html).toContain('page-break-after: always');
    // 没有任何脚本或外部资源
    expect(html).not.toMatch(/<script|<link|<img|src=|url\(/i);
  });
});
