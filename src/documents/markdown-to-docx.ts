/**
 * Markdown AST → Word（P5.1，供 `gen_docx`）。
 *
 * 与 `markdown-to-html.ts` 消费同一棵 AST（`markdown-ast.ts`），两边的语法覆盖面一致。
 * 版式固定、不给调用方调样式的口子（计划 §7：不做 Word 版式编辑）：
 * 正文与标题落到微软雅黑（没有就由 Word 回退），标题黑色加粗，表格细边框、表头浅灰底，
 * 行内代码等宽字体，`---` 分页。每个列表单独一个编号实例，有序列表因此各自从 1 开始。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBaseParagraphStyleOptions,
} from 'docx';
import type { BlockNode, InlineNode, ListNode, MarkdownDocument, TableNode } from './markdown-ast';

/** 与 PDF 的字体栈首选一致；Word 找不到时按自身规则回退，不打包字体。 */
export const DOCX_BODY_FONT = 'Microsoft YaHei';
export const DOCX_CODE_FONT = 'Consolas';

const BULLET_REFERENCE = 'shorekeeper-bullets';
const ORDERED_REFERENCE = 'shorekeeper-ordered';
/** 列表最多两级，与解析器的 MAX_LIST_DEPTH 对应。 */
const LIST_LEVELS = [0, 1];
/** twip：1/20 磅。缩进每级 0.5 英寸，悬挂 0.25 英寸。 */
const LIST_INDENT_PER_LEVEL = 720;
const LIST_HANGING = 360;
/** 边框粗细单位是 1/8 磅：6 即 0.75 磅，与 PDF 的表格线一致。 */
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 6, color: '8A8A8A' } as const;
const HEADER_FILL = 'EEF0F3';
const CODE_FILL = 'F2F3F5';

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

/** 标题字号（半磅）：18 / 15 / 13 / 11.5 磅，与 PDF 样式表对应。 */
const HEADING_SIZES: Record<1 | 2 | 3 | 4 | 5 | 6, number> = { 1: 36, 2: 30, 3: 26, 4: 23, 5: 23, 6: 23 };

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
}

/** 行内节点 → TextRun 序列。粗斜体嵌套靠把样式一路传下去。 */
export function buildInlineRuns(nodes: InlineNode[], style: InlineStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        runs.push(new TextRun({ text: node.value, ...style }));
        break;
      case 'strong':
        runs.push(...buildInlineRuns(node.children, { ...style, bold: true }));
        break;
      case 'emphasis':
        runs.push(...buildInlineRuns(node.children, { ...style, italics: true }));
        break;
      case 'code':
        runs.push(
          new TextRun({
            text: node.value,
            font: DOCX_CODE_FONT,
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
            ...style,
          }),
        );
        break;
      case 'break':
        runs.push(new TextRun({ break: 1 }));
        break;
      default:
        break;
    }
  }
  return runs;
}

/** 编号实例计数器：每个列表（含子列表）一个实例，Word 里的编号才会各自从 1 开始。 */
interface BuildState {
  nextListInstance: number;
}

function buildList(list: ListNode, level: number, state: BuildState): Paragraph[] {
  const instance = state.nextListInstance;
  state.nextListInstance += 1;
  const reference = list.ordered ? ORDERED_REFERENCE : BULLET_REFERENCE;
  const paragraphs: Paragraph[] = [];
  for (const item of list.items) {
    paragraphs.push(
      new Paragraph({
        numbering: { reference, level, instance },
        children: buildInlineRuns(item.children),
      }),
    );
    if (item.sublist) {
      paragraphs.push(...buildList(item.sublist, Math.min(level + 1, LIST_LEVELS.length - 1), state));
    }
  }
  return paragraphs;
}

function buildCell(nodes: InlineNode[], header: boolean): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: buildInlineRuns(nodes, header ? { bold: true } : {}) })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    ...(header ? { shading: { type: ShadingType.CLEAR, fill: HEADER_FILL } } : {}),
  });
}

function buildTable(table: TableNode): Table {
  const rows = [
    new TableRow({ tableHeader: true, children: table.header.map((cell) => buildCell(cell, true)) }),
    ...table.rows.map((row) => new TableRow({ children: row.map((cell) => buildCell(cell, false)) })),
  ];
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
  });
}

export function buildBlock(block: BlockNode, state: BuildState): Array<Paragraph | Table> {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({ heading: HEADING_LEVELS[block.level], children: buildInlineRuns(block.children) })];
    case 'paragraph':
      return [new Paragraph({ children: buildInlineRuns(block.children) })];
    case 'list':
      return buildList(block, 0, state);
    case 'table':
      return [buildTable(block)];
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    default:
      return [];
  }
}

/** 覆盖 docx 库自带的标题样式（默认是蓝色 Calibri Light），不能另起同名样式，否则 Word 取第一个。 */
function headingStyle(level: 1 | 2 | 3 | 4 | 5 | 6): IBaseParagraphStyleOptions {
  return {
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { size: HEADING_SIZES[level], bold: true, color: '1A1A1A', font: DOCX_BODY_FONT },
    paragraph: {
      spacing: { before: level === 1 ? 360 : 280, after: 120 },
      keepNext: true,
      outlineLevel: level - 1,
    },
  };
}

function listLevels(ordered: boolean) {
  return LIST_LEVELS.map((level) => ({
    level,
    format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : level === 0 ? '•' : '◦',
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: { indent: { left: LIST_INDENT_PER_LEVEL * (level + 1), hanging: LIST_HANGING } },
    },
  }));
}

export interface DocxDocumentInput {
  title: string;
  document: MarkdownDocument;
}

/** 完整 Word 文档：标题作为首个一级标题，正文由 AST 映射。 */
export function buildDocxDocument(input: DocxDocumentInput): Document {
  const state: BuildState = { nextListInstance: 0 };
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: input.title })] }),
  ];
  for (const block of input.document.blocks) {
    children.push(...buildBlock(block, state));
  }
  return new Document({
    title: input.title,
    creator: 'TheShorekeeper',
    styles: {
      default: {
        document: {
          run: { font: DOCX_BODY_FONT, size: 22 },
          paragraph: { spacing: { after: 120, line: 330 } },
        },
        heading1: headingStyle(1),
        heading2: headingStyle(2),
        heading3: headingStyle(3),
        heading4: headingStyle(4),
        heading5: headingStyle(5),
        heading6: headingStyle(6),
      },
    },
    numbering: {
      config: [
        { reference: BULLET_REFERENCE, levels: listLevels(false) },
        { reference: ORDERED_REFERENCE, levels: listLevels(true) },
      ],
    },
    sections: [{ children }],
  });
}

export async function renderDocxBuffer(input: DocxDocumentInput): Promise<Buffer> {
  return Packer.toBuffer(buildDocxDocument(input));
}
