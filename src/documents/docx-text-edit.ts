/**
 * Word 原位改文字的 L1：输入 `word/document.xml` 字符串与 edits，输出新字符串与变更列表。
 *
 * 纯函数、不引入 XML 库：按 `<w:p …>…</w:p>` 切段，段内取 `<w:t>` 文本拼成段落字符串再匹配。
 * 命中范围落在哪些 `<w:t>` 上，就把替换文本写进第一个命中的 `<w:t>`（保留它所在 run 的样式），
 * 其余命中 `<w:t>` 只删掉命中的那部分；run 节点、`<w:rPr>`、段落属性、表格结构一律不动。
 *
 * 不处理：页眉页脚、脚注、批注（它们在别的部件里，天然碰不到）；域代码段落（`<w:fldChar` /
 * `<w:instrText` / `<w:fldSimple`）与文本框（`<w:txbxContent`）跳过不参与匹配；
 * 文件里有修订记录（`<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>`）整体拒绝。
 * `<w:tab/>` 计作 `\t`、`<w:br/>` / `<w:cr/>` 计作 `\n` 参与拼接，但命中范围不能跨过它们，
 * 因此 `find` 里含制表符或换行一律先拒绝，避免"永远匹配不到"的困惑。
 */

export interface DocxTextEdit {
  find: string;
  replace: string;
  occurrence?: 'first' | 'all';
}

export interface DocxParagraphChange {
  /** 段落在正文里的序号（从 1 起，只数参与匹配的顶层段落） */
  paragraph: number;
  before: string;
  after: string;
}

export interface DocxEditOutcome {
  find: string;
  replace: string;
  occurrence: 'first' | 'all';
  /** 实际替换的次数 */
  replaced: number;
}

export interface DocxTextEditResult {
  xml: string;
  edits: DocxEditOutcome[];
  /** 受影响的段落，按文档顺序，每段只出现一次（before 是所有 edits 之前，after 是之后） */
  changes: DocxParagraphChange[];
}

export class DocxTextEditError extends Error {
  constructor(message: string, readonly reason: DocxTextEditErrorReason) {
    super(message);
    this.name = 'DocxTextEditError';
  }
}

export type DocxTextEditErrorReason =
  | 'tracked_changes'
  | 'invalid_find'
  | 'not_found'
  | 'malformed';

export const MAX_DOCX_TEXT_EDITS = 200;

const TRACKED_CHANGE = /<w:(ins|del|moveFrom|moveTo)[\s>]/;
const PARAGRAPH_OPEN = /<w:p[\s>/]/g;
const TEXT_NODE = /<w:t(?:\s[^>]*?)?\s*(?:\/>|>([\s\S]*?)<\/w:t>)/g;
const TEXT_NODE_HEAD = /^<w:t[\s/>]/;
const BARRIER = /<w:(?:tab|br|cr)(?:\s[^>]*)?\/>/g;

interface TextNode {
  /** 段落 XML 里 `<w:t …>` 的起止 */
  xmlStart: number;
  xmlEnd: number;
  /** 段落文本里的起止 */
  start: number;
  end: number;
  text: string;
}

interface ParagraphModel {
  xmlStart: number;
  xmlEnd: number;
  text: string;
  nodes: TextNode[];
  /** 段落文本里制表符 / 换行占据的位置 */
  barriers: number[];
  skipped: boolean;
}

/** 找到与 `<w:p …>` 配对的 `</w:p>`（文本框会嵌套段落，按深度配对） */
function findParagraphEnd(xml: string, openStart: number): number {
  const scanner = /<w:p[\s>/]|<\/w:p>/g;
  scanner.lastIndex = openStart;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(xml))) {
    if (match[0] === '</w:p>') {
      depth -= 1;
      if (depth === 0) return match.index + match[0].length;
      continue;
    }
    const tagEnd = xml.indexOf('>', match.index);
    if (tagEnd < 0) break;
    if (xml[tagEnd - 1] === '/') {
      // `<w:p/>` 或 `<w:p …/>`：空段落，自闭合
      if (depth === 0) return tagEnd + 1;
      scanner.lastIndex = tagEnd + 1;
      continue;
    }
    depth += 1;
  }
  throw new DocxTextEditError('document.xml 结构损坏：段落没有闭合', 'malformed');
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g, (whole, name: string) => {
    switch (name) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return name.startsWith('#x')
          ? String.fromCodePoint(parseInt(name.slice(2), 16))
          : String.fromCodePoint(parseInt(name.slice(1), 10));
    }
  });
}

function encodeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把一个顶层段落解析成"文本 + 文本节点位置"模型。文本框、域代码段落标记为 skipped。 */
function parseParagraph(xml: string, xmlStart: number, xmlEnd: number): ParagraphModel {
  const body = xml.slice(xmlStart, xmlEnd);
  const skipped =
    body.includes('<w:txbxContent') ||
    body.includes('<w:fldChar') ||
    body.includes('<w:instrText') ||
    body.includes('<w:fldSimple');
  const nodes: TextNode[] = [];
  const barriers: number[] = [];
  let text = '';
  if (!skipped) {
    // 文本节点与制表符 / 换行按出现顺序交错，统一扫描；段落属性里的制表位定义（`<w:tabs><w:tab …/>`）不算
    const scanner = new RegExp(`${TEXT_NODE.source}|${BARRIER.source}`, 'g');
    const propertiesEnd = body.indexOf('</w:pPr>');
    scanner.lastIndex = propertiesEnd >= 0 ? propertiesEnd + '</w:pPr>'.length : 0;
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(body))) {
      if (TEXT_NODE_HEAD.test(match[0])) {
        const raw = match[1] ?? '';
        const value = decodeEntities(raw);
        nodes.push({
          xmlStart: match.index,
          xmlEnd: match.index + match[0].length,
          start: text.length,
          end: text.length + value.length,
          text: value,
        });
        text += value;
      } else {
        barriers.push(text.length);
        text += match[0].startsWith('<w:tab') ? '\t' : '\n';
      }
    }
  }
  return { xmlStart, xmlEnd, text, nodes, barriers, skipped };
}

function parseParagraphs(xml: string): ParagraphModel[] {
  const paragraphs: ParagraphModel[] = [];
  PARAGRAPH_OPEN.lastIndex = 0;
  let cursor = 0;
  while (cursor < xml.length) {
    PARAGRAPH_OPEN.lastIndex = cursor;
    const open = PARAGRAPH_OPEN.exec(xml);
    if (!open) break;
    const end = findParagraphEnd(xml, open.index);
    paragraphs.push(parseParagraph(xml, open.index, end));
    cursor = end;
  }
  return paragraphs;
}

interface Hit {
  start: number;
  end: number;
}

function findHits(text: string, needle: string, barriers: number[], all: boolean): Hit[] {
  const hits: Hit[] = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset);
    if (index < 0) break;
    const end = index + needle.length;
    // 命中范围压在制表符 / 换行上：不算命中（find 里本来就不允许含这些字符，这里只是双保险）
    if (!barriers.some((position) => position >= index && position < end)) {
      hits.push({ start: index, end });
      if (!all) break;
    }
    offset = end;
  }
  return hits;
}

interface NodeSplice {
  /** 节点文本里的起止 */
  start: number;
  end: number;
  replacement: string;
}

/** 对一段应用一组命中，返回新的段落 XML 与新的段落文本 */
function rewriteParagraph(
  xml: string,
  paragraph: ParagraphModel,
  hits: Hit[],
  replacement: string,
): { body: string; text: string } {
  const splices = new Map<TextNode, NodeSplice[]>();
  for (const hit of hits) {
    let first = true;
    for (const node of paragraph.nodes) {
      if (node.end <= hit.start || node.start >= hit.end) continue;
      // 空节点（`<w:t/>`）在字符串里占零长度，不会与任何命中相交
      const list = splices.get(node) ?? [];
      list.push({
        start: Math.max(hit.start, node.start) - node.start,
        end: Math.min(hit.end, node.end) - node.start,
        replacement: first ? replacement : '',
      });
      splices.set(node, list);
      first = false;
    }
  }

  let body = xml.slice(paragraph.xmlStart, paragraph.xmlEnd);
  // 从后往前拼，前面节点的位置不受影响
  for (let i = paragraph.nodes.length - 1; i >= 0; i -= 1) {
    const node = paragraph.nodes[i];
    const list = splices.get(node);
    if (!list) continue;
    let value = node.text;
    for (const splice of [...list].sort((a, b) => b.start - a.start)) {
      value = value.slice(0, splice.start) + splice.replacement + value.slice(splice.end);
    }
    const element = `<w:t xml:space="preserve">${encodeText(value)}</w:t>`;
    body = body.slice(0, node.xmlStart) + element + body.slice(node.xmlEnd);
  }

  let text = paragraph.text;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, hit.start) + replacement + text.slice(hit.end);
  }
  return { body, text };
}

function validateEdits(edits: DocxTextEdit[]): void {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new DocxTextEditError('edits 必须是非空数组', 'invalid_find');
  }
  if (edits.length > MAX_DOCX_TEXT_EDITS) {
    throw new DocxTextEditError(`单次最多 ${MAX_DOCX_TEXT_EDITS} 处修改`, 'invalid_find');
  }
  edits.forEach((edit, index) => {
    if (!edit || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
      throw new DocxTextEditError(`第 ${index + 1} 项修改缺少 find 或 replace`, 'invalid_find');
    }
    if (!edit.find) {
      throw new DocxTextEditError(`第 ${index + 1} 项修改的 find 不能为空`, 'invalid_find');
    }
    if (/[\n\r\t]/.test(edit.find)) {
      throw new DocxTextEditError(
        `第 ${index + 1} 项修改的 find 含换行或制表符：匹配以段落为单位，不支持跨段落、跨制表符的原文`,
        'invalid_find',
      );
    }
    if (edit.occurrence !== undefined && edit.occurrence !== 'first' && edit.occurrence !== 'all') {
      throw new DocxTextEditError(`第 ${index + 1} 项修改的 occurrence 只能是 first 或 all`, 'invalid_find');
    }
  });
}

/**
 * 应用 edits。任一 edit 一处都没命中即抛 `not_found`，整份文档不改（与 replace_text 的校验口径一致）。
 * edits 依次生效：后一项能匹配到前一项替换出来的文字。
 */
export function applyDocxTextEdits(documentXml: string, edits: DocxTextEdit[]): DocxTextEditResult {
  validateEdits(edits);
  if (TRACKED_CHANGE.test(documentXml)) {
    throw new DocxTextEditError(
      '文档里有未接受的修订记录，请先在 Word 里"接受所有修订"或"拒绝所有修订"再改',
      'tracked_changes',
    );
  }

  let xml = documentXml;
  const originalText = new Map<number, string>();
  const touched = new Set<number>();
  const outcomes: DocxEditOutcome[] = [];

  for (const edit of edits) {
    const occurrence = edit.occurrence ?? 'first';
    const paragraphs = parseParagraphs(xml);
    let replaced = 0;
    let rebuilt = '';
    let cursor = 0;
    let stop = false;
    paragraphs.forEach((paragraph, index) => {
      if (stop || paragraph.skipped || paragraph.nodes.length === 0) return;
      const hits = findHits(paragraph.text, edit.find, paragraph.barriers, occurrence === 'all');
      if (hits.length === 0) return;
      if (!originalText.has(index)) originalText.set(index, paragraph.text);
      touched.add(index);
      const { body } = rewriteParagraph(xml, paragraph, hits, edit.replace);
      rebuilt += xml.slice(cursor, paragraph.xmlStart) + body;
      cursor = paragraph.xmlEnd;
      replaced += hits.length;
      if (occurrence === 'first') stop = true;
    });
    if (replaced === 0) {
      throw new DocxTextEditError(
        `正文里找不到「${truncate(edit.find)}」；页眉页脚、脚注、批注与域代码不参与匹配，且原文不能跨段落`,
        'not_found',
      );
    }
    xml = rebuilt + xml.slice(cursor);
    outcomes.push({ find: edit.find, replace: edit.replace, occurrence, replaced });
  }

  const finalParagraphs = parseParagraphs(xml);
  const changes: DocxParagraphChange[] = [...touched]
    .sort((a, b) => a - b)
    .map((index) => ({
      paragraph: index + 1,
      before: originalText.get(index) ?? '',
      after: finalParagraphs[index]?.text ?? '',
    }));
  return { xml, edits: outcomes, changes };
}

/** 只读：正文各顶层段落的文本（跳过的段落给空串），供预览与测试对照 */
export function listDocxParagraphTexts(documentXml: string): string[] {
  return parseParagraphs(documentXml).map((paragraph) => (paragraph.skipped ? '' : paragraph.text));
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
