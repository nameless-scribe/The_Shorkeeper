/**
 * PDF 页面模型 → Markdown（纯函数）。
 *
 * 表格、段落、独立图片按各自在页面上的纵向位置排序输出；表格内的换行写成 <br>，
 * 图片写成 ![](相对路径)，路径由调用方（抽图之后）提供，没抽出来的图片只留一句占位说明。
 */

import {
  groupParagraphs,
  groupTextLines,
  type PdfPageLayout,
  type PdfTable,
  type PdfTableCell,
} from './pdf-layout';

export type PdfImageRefs = ReadonlyMap<string, string>;

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

function imageMarkdown(name: string, refs: PdfImageRefs, pageNum: number, index: number): string {
  const target = refs.get(name);
  const label = `第 ${pageNum} 页图 ${index}`;
  return target ? `![${label}](${target})` : `（${label}，未抽取）`;
}

interface Block {
  y: number;
  markdown: string;
}

function cellMarkdown(cell: PdfTableCell, refs: PdfImageRefs, pageNum: number, nextIndex: () => number): string {
  const parts: string[] = [];
  for (const name of cell.images) parts.push(imageMarkdown(name, refs, pageNum, nextIndex()));
  if (cell.text) parts.push(escapeTableCell(cell.text));
  return parts.join(' ');
}

/** 顶部只有一个非空格子、且横跨整表的行是标题行（合并单元格），作为加粗段落放到表格前面。 */
function splitCaptionRows(table: PdfTable): { captions: string[]; rows: PdfTableCell[][] } {
  const captions: string[] = [];
  let start = 0;
  while (start < table.rows.length) {
    const row = table.rows[start];
    const filled = row.filter((cell) => cell.text || cell.images.length);
    const spansTable = row.length === 1 && row[0].width >= table.width * 0.9;
    if (filled.length === 1 && spansTable && filled[0].text && !filled[0].images.length) {
      captions.push(filled[0].text.replace(/\s*\n\s*/g, ' '));
      start += 1;
      continue;
    }
    break;
  }
  return { captions, rows: table.rows.slice(start) };
}

export function renderPdfTableMarkdown(table: PdfTable, refs: PdfImageRefs, pageNum: number, nextIndex: () => number): string {
  const { captions, rows } = splitCaptionRows(table);
  const width = Math.max(...rows.map((row) => row.length), 0);
  if (!width || !rows.length) {
    return captions.map((caption) => `**${caption}**`).join('\n\n');
  }
  const rendered = rows.map((row) => {
    const cells = row.map((cell) => cellMarkdown(cell, refs, pageNum, nextIndex));
    while (cells.length < width) cells.push('');
    return `| ${cells.join(' | ')} |`;
  });
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  const lines = [...captions.map((caption) => `**${caption}**\n`), rendered[0], separator, ...rendered.slice(1)];
  return lines.join('\n');
}

/** 一页的 Markdown 正文（不含页码注释与文档标题）。 */
export function renderPdfPageMarkdown(layout: PdfPageLayout, refs: PdfImageRefs = new Map()): string {
  let imageIndex = 0;
  const nextIndex = () => {
    imageIndex += 1;
    return imageIndex;
  };
  const blocks: Block[] = [];

  for (const paragraph of groupParagraphs(groupTextLines(layout.freeText))) {
    blocks.push({ y: paragraph.y, markdown: paragraph.lines.join('\n') });
  }
  // 表格与图片的 y 是顶边，文字的 y 是基线；同一位置时让表格排在其顶边附近的文字之后
  for (const table of layout.tables) {
    const markdown = renderPdfTableMarkdown(table, refs, layout.num, nextIndex);
    if (markdown) blocks.push({ y: table.y + 0.01, markdown });
  }
  for (const image of layout.freeImages) {
    blocks.push({ y: image.y + 0.01, markdown: imageMarkdown(image.id, refs, layout.num, nextIndex()) });
  }

  return blocks
    .sort((a, b) => a.y - b.y)
    .map((block) => block.markdown)
    .join('\n\n')
    .trim();
}
