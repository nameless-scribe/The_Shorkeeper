/**
 * Markdown AST → 可打印 HTML（P5.0，供 `gen_pdf` 经 Electron `printToPDF` 输出）。
 *
 * 所有文本都经 HTML 转义：正文来自模型，绝不能把它当作标记语言解释。
 * 样式内联且固定，不给调用方调样式的口子；中文靠字体栈落到系统字体，不打包字体文件。
 */

import type { BlockNode, InlineNode, ListNode, MarkdownDocument, TableNode } from './markdown-ast';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInlineHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeHtml(node.value);
        case 'strong':
          return `<strong>${renderInlineHtml(node.children)}</strong>`;
        case 'emphasis':
          return `<em>${renderInlineHtml(node.children)}</em>`;
        case 'code':
          return `<code>${escapeHtml(node.value)}</code>`;
        case 'break':
          return '<br>';
        default:
          return '';
      }
    })
    .join('');
}

function renderList(list: ListNode): string {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items
    .map((item) => {
      const sub = item.sublist ? renderList(item.sublist) : '';
      return `<li>${renderInlineHtml(item.children)}${sub}</li>`;
    })
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderTable(table: TableNode): string {
  const head = table.header.map((cell) => `<th>${renderInlineHtml(cell)}</th>`).join('');
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderBlockHtml(block: BlockNode): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${renderInlineHtml(block.children)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${renderInlineHtml(block.children)}</p>`;
    case 'list':
      return renderList(block);
    case 'table':
      return renderTable(block);
    case 'pageBreak':
      return '<div class="page-break"></div>';
    default:
      return '';
  }
}

export function renderMarkdownBodyHtml(document: MarkdownDocument): string {
  return document.blocks.map(renderBlockHtml).join('\n');
}

/** 与 `gen_chart` 共用的字体栈：中文优先落到 Windows / macOS / Linux 的系统中文字体。 */
export const PRINT_FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", sans-serif';

const PRINT_STYLES = `
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${PRINT_FONT_STACK};
    font-size: 11pt;
    line-height: 1.65;
    color: #1a1a1a;
    background: #ffffff;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  h1.doc-title { font-size: 22pt; margin: 0 0 18pt; padding-bottom: 6pt; border-bottom: 1.5pt solid #333; }
  h1 { font-size: 18pt; margin: 18pt 0 8pt; }
  h2 { font-size: 15pt; margin: 16pt 0 6pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  h4, h5, h6 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.35; page-break-after: avoid; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
  li { margin: 2pt 0; }
  li > ul, li > ol { margin: 2pt 0 0; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 10.5pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 0.75pt solid #8a8a8a; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #eef0f3; font-weight: 600; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 10pt; background: #f2f3f5; padding: 0 3pt; border-radius: 2pt; }
  .page-break { page-break-after: always; break-after: page; height: 0; }
`;

export interface PrintableDocumentInput {
  title: string;
  document: MarkdownDocument;
}

/** 完整 HTML 文档：标题作为首个一级标题，正文由 AST 渲染。 */
export function renderPrintableHtmlDocument(input: PrintableDocumentInput): string {
  const title = escapeHtml(input.title);
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    `<style>${PRINT_STYLES}</style>`,
    '</head>',
    '<body>',
    `<h1 class="doc-title">${title}</h1>`,
    renderMarkdownBodyHtml(input.document),
    '</body>',
    '</html>',
  ].join('\n');
}
