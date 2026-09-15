import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../markdown-ast';
import { buildInlineRuns, DOCX_BODY_FONT, DOCX_CODE_FONT, renderDocxBuffer } from '../markdown-to-docx';
import { loadMammoth } from '../../tools/doc/doc-loaders';
import { listZipEntries, readZipEntry } from './read-zip-entry';

const SAMPLE = [
  '# 一级',
  '## 二级',
  '### 三级',
  '#### 四级',
  '',
  '普通段落，含 **粗体**、*斜体*、***粗斜***、`代码` 与 <script>alert(1)</script> 文本。',
  '第二行是软换行。',
  '',
  '- 无序一',
  '  - 子项甲',
  '  - 子项乙',
  '- 无序二',
  '',
  '1. 有序一',
  '2. 有序二',
  '   1. 子步骤',
  '',
  '中间一段正文把两个有序列表隔开。',
  '',
  '1. 另一个有序列表',
  '2. 应从 1 重新开始',
  '',
  '| 项目 | 金额 | 备注 |',
  '| --- | --- | --- |',
  '| 甲 | 1 | **重点** |',
  '| 乙 | 2 | |',
  '',
  '---',
  '',
  '第二页。',
].join('\n');

async function render(body: string, title = '标题') {
  return renderDocxBuffer({ title, document: parseMarkdown(body) });
}

function count(haystack: string, needle: string | RegExp): number {
  return (haystack.match(needle instanceof RegExp ? needle : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
}

describe('markdown → docx', () => {
  it('produces a Word package whose XML carries headings, lists, tables, breaks and fonts', async () => {
    const buffer = await render(SAMPLE, '样本<标题>');
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const entries = listZipEntries(buffer);
    expect(entries).toContain('word/document.xml');
    expect(entries).toContain('word/numbering.xml');
    expect(entries).toContain('word/styles.xml');

    const document = readZipEntry(buffer, 'word/document.xml');
    // 标题作为首个一级标题，正文里的各级标题按级别映射
    expect(count(document, 'w:pStyle w:val="Heading1"')).toBe(2);
    expect(count(document, 'w:pStyle w:val="Heading2"')).toBe(1);
    expect(count(document, 'w:pStyle w:val="Heading3"')).toBe(1);
    expect(count(document, 'w:pStyle w:val="Heading4"')).toBe(1);
    // 正文来自模型，必须按文字写入而不是标记
    expect(document).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(document).toContain('样本&lt;标题&gt;');
    // 粗斜体与代码
    expect(count(document, '<w:b/>')).toBeGreaterThanOrEqual(2);
    expect(count(document, '<w:i/>')).toBeGreaterThanOrEqual(2);
    expect(document).toContain(`w:ascii="${DOCX_CODE_FONT}"`);
    // 软换行与分页
    expect(document).toContain('<w:br/>');
    expect(document).toContain('<w:br w:type="page"/>');
    // 表格：表头行标记、三列、边框
    expect(count(document, '<w:tbl>')).toBe(1);
    expect(document).toContain('<w:tblHeader/>');
    expect(count(document, '<w:tc>')).toBe(9);
    expect(document).toContain('w:fill="EEF0F3"');

    // 列表：9 个列表段落，5 个列表（顶层无序 / 有序各带一个子列表，加隔开的第二个有序列表）→ 5 个编号实例，Word 里各自从 1 起
    expect(count(document, '<w:numPr>')).toBe(9);
    const numIds = new Set([...document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(numIds.size).toBe(5);
    expect(count(document, '<w:ilvl w:val="1"/>')).toBe(3);

    const numbering = readZipEntry(buffer, 'word/numbering.xml');
    expect(numbering).toContain('w:numFmt w:val="bullet"');
    expect(numbering).toContain('w:numFmt w:val="decimal"');
    expect(numbering).toContain('w:lvlText w:val="%2."');

    const styles = readZipEntry(buffer, 'word/styles.xml');
    expect(styles).toContain(`w:ascii="${DOCX_BODY_FONT}"`);
    // 覆盖默认标题样式后不能出现重复的 styleId，否则 Word 会取第一个（蓝色 Calibri）
    expect(count(styles, 'w:styleId="Heading1"')).toBe(1);
    expect(count(styles, 'w:styleId="Heading2"')).toBe(1);
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Heading2">(?:(?!<\/w:style>).)*<w:sz w:val="30"\/>/);
    expect(styles).not.toContain('w:color w:val="2E74B5"');
  });

  it('reads back through mammoth with the same structure', async () => {
    const buffer = await render(SAMPLE, '样本');
    const mammoth = await loadMammoth();
    const { value: html } = await mammoth.convertToHtml({ buffer });
    expect(html).toContain('<h1>样本</h1>');
    expect(html).toContain('<h2>二级</h2>');
    expect(html).toContain('<h4>四级</h4>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toMatch(/<strong><em>粗斜<\/em><\/strong>|<em><strong>粗斜<\/strong><\/em>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<ul><li>无序一<ul><li>子项甲</li><li>子项乙</li></ul></li><li>无序二</li></ul>');
    expect(html).toContain('<ol><li>有序一</li><li>有序二<ol><li>子步骤</li></ol></li></ol><p>中间一段正文把两个有序列表隔开。</p><ol><li>另一个有序列表</li><li>应从 1 重新开始</li></ol>');
    expect(html).toContain('<table><thead><tr><th><p><strong>项目</strong></p></th>');
    expect(html).toContain('<td><p>甲</p></td>');
    expect(html).toContain('第二页。');
  });

  it('keeps plain text callers unchanged: every line becomes its own paragraph line', async () => {
    const buffer = await render('段落一第一行\n段落一第二行\n\n段落二');
    const document = readZipEntry(buffer, 'word/document.xml');
    expect(count(document, '<w:p>') + count(document, '<w:p ')).toBe(3);
    expect(document).toContain('段落一第一行');
    expect(document).toContain('<w:br/>');
    expect(document).not.toContain('<w:numPr>');
    expect(document).not.toContain('<w:tbl>');
  });

  it('handles an empty body', async () => {
    const buffer = await render('');
    const mammoth = await loadMammoth();
    const { value: html } = await mammoth.convertToHtml({ buffer });
    expect(html).toBe('<h1>标题</h1>');
  });

  it('nests bold and italic flags when building runs', () => {
    const runs = buildInlineRuns(parseInline('**粗里有*斜*** 普通'));
    expect(runs).toHaveLength(3);
  });
});
