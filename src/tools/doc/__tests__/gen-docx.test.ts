import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { genDocxTool, MAX_DOCX_BODY_CHARS } from '../gen-tools';
import { loadMammoth } from '../doc-loaders';
import { readZipEntry } from '../../../documents/__tests__/read-zip-entry';

function context(root: string) {
  return { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };
}

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sk-docx-'));
}

describe('gen_docx', () => {
  it('rejects missing arguments, non-docx paths and oversized bodies without writing anything', async () => {
    const root = await workspace();
    const missing = await genDocxTool.execute({ path: 'a.docx', title: '' }, context(root));
    expect(missing.success).toBe(false);
    expect(missing.errorCategory).toBe('invalid_arguments');

    const wrongSuffix = await genDocxTool.execute({ path: 'a.doc', title: 't', body: 'x' }, context(root));
    expect(wrongSuffix.success).toBe(false);
    expect(wrongSuffix.error).toContain('.docx');

    const tooLong = await genDocxTool.execute(
      { path: 'a.docx', title: 't', body: 'x'.repeat(MAX_DOCX_BODY_CHARS + 1) },
      context(root),
    );
    expect(tooLong.success).toBe(false);
    expect(tooLong.error).toContain('正文过长');

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('lays out a Markdown body as headings, lists and tables and reports the artifact', async () => {
    const root = await workspace();
    const result = await genDocxTool.execute(
      {
        path: '方案/培训方案.docx',
        title: '客户培训方案',
        body: [
          '## 目标',
          '',
          '让一线同事 **两周内** 上手。',
          '',
          '1. 第一周：基础',
          '2. 第二周：实操',
          '',
          '| 阶段 | 天数 |',
          '| --- | --- |',
          '| 基础 | 5 |',
          '',
          '---',
          '',
          '附录页。',
        ].join('\n'),
      },
      context(root),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('方案/培训方案.docx');
    expect(result.artifacts?.[0]?.relativePath).toBe('方案/培训方案.docx');

    const buffer = await fs.readFile(path.join(root, '方案/培训方案.docx'));
    const mammoth = await loadMammoth();
    const { value: html } = await mammoth.convertToHtml({ buffer });
    expect(html).toContain('<h1>客户培训方案</h1>');
    expect(html).toContain('<h2>目标</h2>');
    expect(html).toContain('<strong>两周内</strong>');
    expect(html).toContain('<ol><li>第一周：基础</li><li>第二周：实操</li></ol>');
    expect(html).toContain('<td><p>基础</p></td>');
    expect(html).toContain('附录页。');
    expect(readZipEntry(buffer, 'word/document.xml')).toContain('<w:br w:type="page"/>');
  });

  it('keeps plain-text bodies working: blank lines split paragraphs, single newlines stay inside', async () => {
    const root = await workspace();
    const result = await genDocxTool.execute(
      { path: 'plain.docx', title: '纯文本', body: '第一段第一行\n第一段第二行\n\n第二段' },
      context(root),
    );
    expect(result.success).toBe(true);
    const mammoth = await loadMammoth();
    const { value: html } = await mammoth.convertToHtml({ buffer: await fs.readFile(path.join(root, 'plain.docx')) });
    expect(html).toBe('<h1>纯文本</h1><p>第一段第一行<br />第一段第二行</p><p>第二段</p>');
  });
});
