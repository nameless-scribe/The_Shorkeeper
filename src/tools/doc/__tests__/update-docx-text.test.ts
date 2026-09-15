import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  Document,
  Header,
  InsertedTextRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { updateDocxTextTool } from '../update-docx-text';
import { loadMammoth } from '../doc-loaders';
import { listDocxParagraphTexts } from '../../../documents/docx-text-edit';
import { readZipEntry } from '../../../documents/__tests__/read-zip-entry';

function context(root: string, extra: { preview?: boolean; previewRevision?: string } = {}) {
  return { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal, ...extra };
}

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sk-docx-edit-'));
}

/** 带样式的样本：页眉、多 run 段落、同文本多处、表格、域代码 */
async function sampleDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph('页眉：交付日期 9 月 15 日')] }) },
        children: [
          new Paragraph({ children: [new TextRun('项目'), new TextRun({ text: '交付日期', bold: true }), new TextRun('为 9 月 15 日。')] }),
          new Paragraph({ children: [new TextRun('甲方：星泓科技；甲方联系人：王工')] }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('数量')] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '12', italics: true })] })] }),
                ],
              }),
            ],
          }),
          new Paragraph({ children: [new TextRun('第 '), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(' 页，共 9 月 15 日')] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

async function trackedDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('正文'), new InsertedTextRun({ text: '新增', id: 1, author: 'A', date: '2026-09-15T00:00:00Z' })] })] }],
  });
  return Packer.toBuffer(document);
}

async function entries(buffer: Buffer): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(buffer);
  const map = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) map.set(name, await file.async('uint8array'));
  }
  return map;
}

describe('update_docx_text', () => {
  it('validates arguments before touching the file', async () => {
    const root = await workspace();
    const missing = await updateDocxTextTool.execute({ edits: [{ find: 'a', replace: 'b' }] }, context(root));
    expect(missing.success).toBe(false);
    expect(missing.errorCategory).toBe('invalid_arguments');
    const doc = await updateDocxTextTool.execute({ source_path: 'a.doc', edits: [{ find: 'a', replace: 'b' }] }, context(root));
    expect(doc.error).toContain('.docx');
    const noEdits = await updateDocxTextTool.execute({ source_path: 'a.docx', edits: [] }, context(root));
    expect(noEdits.error).toContain('非空');
    const badOutput = await updateDocxTextTool.execute({ source_path: 'a.docx', output_path: 'b.txt', edits: [{ find: 'a', replace: 'b' }] }, context(root));
    expect(badOutput.error).toContain('output_path');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('previews affected paragraphs, then writes only the target paragraphs and keeps every other part byte-identical', async () => {
    const root = await workspace();
    const original = await sampleDocx();
    await fs.writeFile(path.join(root, '合同.docx'), original);
    const edits = [
      { find: '9 月 15 日', replace: '9 月 30 日' },
      { find: '甲方', replace: '乙方', occurrence: 'all' as const },
      { find: '12', replace: '15' },
    ];

    const preview = await updateDocxTextTool.execute({ source_path: '合同.docx', edits }, context(root, { preview: true }));
    expect(preview.success).toBe(true);
    expect(preview.artifacts).toBeUndefined();
    expect(preview.preview?.kind).toBe('text-diff');
    expect(preview.preview?.target).toBe('合同.docx');
    expect(preview.preview?.changes).toEqual([
      { label: '第 1 段', before: '项目交付日期为 9 月 15 日。', after: '项目交付日期为 9 月 30 日。' },
      { label: '第 2 段', before: '甲方：星泓科技；甲方联系人：王工', after: '乙方：星泓科技；乙方联系人：王工' },
      { label: '第 4 段', before: '12', after: '15' },
    ]);
    expect(preview.preview?.details).toContain('「甲方」→「乙方」× 2');
    // 预览没有写盘
    expect(await fs.readFile(path.join(root, '合同.docx'))).toEqual(original);

    const result = await updateDocxTextTool.execute({ source_path: '合同.docx', edits }, context(root, { previewRevision: preview.preview?.revision }));
    expect(result.success).toBe(true);
    expect(result.output).toContain('替换 4 处文字（3 段）');
    expect(result.artifacts?.[0]?.relativePath).toBe('合同.docx');

    const updated = await fs.readFile(path.join(root, '合同.docx'));
    const before = await entries(original);
    const after = await entries(updated);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) {
      if (name === 'word/document.xml') continue;
      expect(after.get(name), name).toEqual(bytes);
    }
    // document.xml：只有目标段落变了，域代码段落（含"9 月 15 日"）与页眉原样
    const beforeParagraphs = listDocxParagraphTexts(readZipEntry(original, 'word/document.xml'));
    const afterParagraphs = listDocxParagraphTexts(readZipEntry(updated, 'word/document.xml'));
    expect(afterParagraphs).toEqual(
      beforeParagraphs.map((text, index) => ([0, 1, 3].includes(index) ? [
        '项目交付日期为 9 月 30 日。',
        '乙方：星泓科技；乙方联系人：王工',
        '',
        '15',
      ][index] : text)),
    );
    expect(readZipEntry(updated, 'word/document.xml')).toContain('第 </w:t>');
    expect(readZipEntry(updated, 'word/header1.xml')).toContain('交付日期 9 月 15 日');

    const mammoth = await loadMammoth();
    const { value: html } = await mammoth.convertToHtml({ buffer: updated });
    expect(html).toContain('<strong>交付日期</strong>为 9 月 30 日。');
    expect(html).toContain('<em>15</em>');

    // 覆盖源文件时留了备份
    const backups = (await fs.readdir(path.join(root, '.shorekeeper-backups'), { recursive: true }))
      .filter((name) => String(name).includes('合同'));
    expect(backups.length).toBeGreaterThan(0);
  });

  it('writes to output_path without touching the source and rejects a stale preview after an external change', async () => {
    const root = await workspace();
    const original = await sampleDocx();
    await fs.writeFile(path.join(root, 'in.docx'), original);
    const edits = [{ find: '王工', replace: '李工' }];

    const preview = await updateDocxTextTool.execute({ source_path: 'in.docx', output_path: 'out/改后.docx', edits }, context(root, { preview: true }));
    expect(preview.preview?.target).toBe('out/改后.docx');
    const result = await updateDocxTextTool.execute({ source_path: 'in.docx', output_path: 'out/改后.docx', edits }, context(root, { previewRevision: preview.preview?.revision }));
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(root, 'in.docx'))).toEqual(original);
    expect(listDocxParagraphTexts(readZipEntry(await fs.readFile(path.join(root, 'out/改后.docx')), 'word/document.xml'))[1]).toContain('李工');

    // 文件被外部改过：修订号不一致，拒绝执行
    const stalePreview = await updateDocxTextTool.execute({ source_path: 'in.docx', edits }, context(root, { preview: true }));
    await fs.writeFile(path.join(root, 'in.docx'), await trackedDocx());
    const stale = await updateDocxTextTool.execute({ source_path: 'in.docx', edits }, context(root, { previewRevision: stalePreview.preview?.revision }));
    expect(stale.success).toBe(false);
    expect(stale.metadata?.previewStale).toBe(true);
  });

  it('refuses tracked changes, unmatched text and non-docx containers with the file untouched', async () => {
    const root = await workspace();
    const tracked = await trackedDocx();
    await fs.writeFile(path.join(root, 'tracked.docx'), tracked);
    const rejected = await updateDocxTextTool.execute({ source_path: 'tracked.docx', edits: [{ find: '正文', replace: 'x' }] }, context(root));
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('修订记录');
    expect(rejected.metadata?.reason).toBe('tracked_changes');
    expect(await fs.readFile(path.join(root, 'tracked.docx'))).toEqual(tracked);

    await fs.writeFile(path.join(root, 'plain.docx'), await sampleDocx());
    const unmatched = await updateDocxTextTool.execute({ source_path: 'plain.docx', edits: [{ find: '页眉：交付日期', replace: 'x' }] }, context(root));
    expect(unmatched.success).toBe(false);
    expect(unmatched.error).toContain('找不到');
    expect(unmatched.error).toContain('文件未修改');

    await fs.writeFile(path.join(root, 'fake.docx'), 'not a zip');
    const broken = await updateDocxTextTool.execute({ source_path: 'fake.docx', edits: [{ find: 'a', replace: 'b' }] }, context(root));
    expect(broken.success).toBe(false);
    expect(broken.error).toContain('docx');
  });
});
