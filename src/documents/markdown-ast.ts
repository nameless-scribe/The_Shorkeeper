/**
 * Markdown 子集解析器（P5）。
 *
 * 只认这份产品需要的语法，不追求 CommonMark 合规；不认识的写法一律原样当文本，绝不抛错。
 * 解析结果是一棵简单 AST，由 `markdown-to-html.ts`（PDF）与 `markdown-to-docx.ts`（Word）各自映射。
 *
 * 块级：`#`–`######` 标题、段落（空行分隔）、无序列表 `-` / `*` / `+`、有序列表 `1.` / `1)`、
 *       嵌套列表（每级 2 个空格，最多两级）、GFM 管道表格、`---` 分页。
 * 行内：`**粗体**`、`*斜体*`、`` `代码` ``、`[文本](链接)` 只保留文本、`\` 转义。
 * 段落内的换行保留为软换行（`break`），纯文本调用方按行分段的效果因此不变。
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'break' };

export interface ListItemNode {
  children: InlineNode[];
  sublist?: ListNode;
}

export interface ListNode {
  type: 'list';
  ordered: boolean;
  items: ListItemNode[];
}

export interface TableNode {
  type: 'table';
  header: InlineNode[][];
  rows: InlineNode[][][];
}

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | ListNode
  | TableNode
  | { type: 'pageBreak' };

export interface MarkdownDocument {
  blocks: BlockNode[];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const PAGE_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** 列表嵌套深度上限：每级 2 个空格，超过第二级的缩进一律按第二级处理。 */
const MAX_LIST_DEPTH = 2;
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '|', '-', '+', '.', '!', '>']);

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isTableRow(line: string): boolean {
  return line.includes('|') && !isBlank(line);
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  // 首尾的管道符产生空单元格，去掉；中间的空单元格是真实内容
  if (cells.length && cells[0].trim() === '' && line.trimStart().startsWith('|')) cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '' && line.trimEnd().endsWith('|')) cells.pop();
  return cells.map((cell) => cell.trim());
}

function listDepth(indent: string): number {
  return Math.min(MAX_LIST_DEPTH, Math.floor(indent.length / 2) + 1);
}

function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

/** 解析行内语法。未闭合的标记原样保留为文本。 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      nodes.push({ type: 'text', value: text });
      text = '';
    }
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\' && i + 1 < source.length && ESCAPABLE.has(source[i + 1])) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n') {
      flush();
      nodes.push({ type: 'break' });
      i += 1;
      continue;
    }

    if (ch === '`') {
      const close = source.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'code', value: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }

    if (source.startsWith('**', i)) {
      const close = findClosing(source, i + 2, '**');
      if (close > i + 2) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(source.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
      text += '**';
      i += 2;
      continue;
    }

    if (ch === '*') {
      const close = findClosing(source, i + 1, '*');
      const inner = close > i + 1 ? source.slice(i + 1, close) : '';
      if (inner && !inner.startsWith(' ') && !inner.endsWith(' ')) {
        flush();
        nodes.push({ type: 'emphasis', children: parseInline(inner) });
        i = close + 1;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }

    if (ch === '[') {
      const match = /^\[([^\]\n]+)\]\(([^)\s]*)\)/.exec(source.slice(i));
      if (match) {
        flush();
        nodes.push(...parseInline(match[1]));
        i += match[0].length;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }

    text += ch;
    i += 1;
  }
  flush();
  return mergeAdjacentText(nodes);
}

/** 从 from 起找闭合标记；`**` 内不会被单个 `*` 提前闭合，反之亦然。 */
function findClosing(source: string, from: number, marker: string): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '`') {
      const codeEnd = source.indexOf('`', i + 1);
      if (codeEnd > i) {
        i = codeEnd + 1;
        continue;
      }
    }
    if (source.startsWith(marker, i)) {
      if (marker === '*' && source.startsWith('**', i)) {
        i += 2;
        continue;
      }
      // `**a*b***`：三连星号结尾时，若内部还有未闭合的单星号，把第一个星号让给它
      if (marker === '**' && source.startsWith('***', i) && hasUnclosedSingleStar(source.slice(from, i))) {
        return i + 1;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

function hasUnclosedSingleStar(inner: string): boolean {
  let singles = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\') {
      i += 1;
      continue;
    }
    if (inner[i] === '*') {
      if (inner[i + 1] === '*') {
        i += 1;
        continue;
      }
      singles += 1;
    }
  }
  return singles % 2 === 1;
}

function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    if (node.type === 'text' && last?.type === 'text') {
      last.value += node.value;
    } else {
      merged.push(node);
    }
  }
  return merged;
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (PAGE_BREAK.test(line)) {
      flushParagraph();
      blocks.push({ type: 'pageBreak' });
      i += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const parsed = parseList(lines, i);
      blocks.push(parsed.list);
      i = parsed.next;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1])) {
      flushParagraph();
      const parsed = parseTable(lines, i);
      blocks.push(parsed.table);
      i = parsed.next;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return { blocks };
}

function parseTable(lines: string[], start: number): { table: TableNode; next: number } {
  const header = splitTableRow(lines[start]).map(parseInline);
  const width = header.length;
  const rows: InlineNode[][][] = [];
  let i = start + 2;
  while (i < lines.length && isTableRow(lines[i]) && !LIST_ITEM.test(lines[i]) && !HEADING.test(lines[i])) {
    const cells = splitTableRow(lines[i]);
    const normalized = [...cells.slice(0, width), ...Array.from({ length: Math.max(0, width - cells.length) }, () => '')];
    rows.push(normalized.map(parseInline));
    i += 1;
  }
  return { table: { type: 'table', header, rows }, next: i };
}

/** 列表里最后一个被追加的项：第二级存在则是子列表末项，否则是顶层末项。 */
function lastListItem(list: ListNode): ListItemNode | undefined {
  const top = list.items[list.items.length - 1];
  if (!top) return undefined;
  const sub = top.sublist?.items;
  return sub && sub.length ? sub[sub.length - 1] : top;
}

function appendListItem(list: ListNode, depth: number, marker: string, text: string): void {
  const item: ListItemNode = { children: parseInline(text) };
  const parent = list.items[list.items.length - 1];
  if (depth === 1 || !parent) {
    list.items.push(item);
    return;
  }
  if (!parent.sublist) {
    parent.sublist = { type: 'list', ordered: isOrderedMarker(marker), items: [] };
  }
  parent.sublist.items.push(item);
}

function parseList(lines: string[], start: number): { list: ListNode; next: number } {
  const firstMatch = LIST_ITEM.exec(lines[start]);
  const list: ListNode = { type: 'list', ordered: isOrderedMarker(firstMatch?.[2] ?? '-'), items: [] };
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // 空行之后若还是同类列表项，仍属同一个列表（松散列表）；
      // 顶层换了有序/无序，或者根本不是列表项，则列表结束
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const next = j < lines.length ? LIST_ITEM.exec(lines[j]) : null;
      if (next && (listDepth(next[1]) > 1 || isOrderedMarker(next[2]) === list.ordered)) {
        i = j;
        continue;
      }
      break;
    }

    const match = LIST_ITEM.exec(line);
    if (match) {
      appendListItem(list, listDepth(match[1]), match[2], match[3]);
      i += 1;
      continue;
    }

    // 不是列表项、也不是空行：属于上一项的续行（懒续行），除非它是别的块级结构
    if (
      HEADING.test(line) ||
      PAGE_BREAK.test(line) ||
      (isTableRow(line) && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1]))
    ) {
      break;
    }
    const target = lastListItem(list);
    if (target) {
      target.children.push({ type: 'break' }, ...parseInline(line.trim()));
    }
    i += 1;
  }
  return { list, next: i };
}

/** 把行内节点还原为纯文本（用于标题、摘要等只需要文字的场景）。 */
export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'break':
          return '\n';
        case 'strong':
        case 'emphasis':
          return inlineToPlainText(node.children);
        default:
          return '';
      }
    })
    .join('');
}
