/**
 * PDF 版面分析（P5.0 返工）。
 *
 * PDF 里没有"表格"，只有"在 (x, y) 画一个字 / 一个矩形 / 一张图"。要把表格读回来，必须从
 * 绘图指令里重建网格：填充的单元格底色、描边的边框线都算（pdf-parse 自带的 getTable 只认描边，
 * 遇到用底色画格子的表就一个都找不到）。文字按坐标落进格子，落不进的是自由文本；图片按绘制
 * 位置同样归格子或归自由区域。输出的是一个纯数据的页面模型，Markdown 渲染在 pdf-markdown.ts。
 *
 * 坐标统一为 viewport 坐标（原点左上、y 向下、单位 pt）。
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { Line, LineStore, Point, Rectangle } from 'pdf-parse';

type PdfPage = PDFPageProxy;
type TableData = ReturnType<LineStore['getTableData']>[number];

export interface PdfPositionedText {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  hasEOL: boolean;
}

/** 一次绘图指令：某个图片对象画在页面上的位置 */
export interface PdfImagePaint {
  /** pdf.js 的图片对象名，可用 page.objs / page.commonObjs 解出像素 */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 页面上的一张"图"。通常就是一次绘图；WPS 之类的导出器会把一张照片切成几百条细条分别画，
 * 这时一张图由多次绘图拼成（members 多于一个），抽图时按各自位置拼回去。
 */
export interface PdfImagePlacement {
  /** 页内唯一，作为 Markdown 引用与落盘命名的键 */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: PdfImagePaint[];
}

export interface PdfTableCell {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 格内文字，换行用 \n */
  text: string;
  /** 落在格内的图片 id（见 PdfImagePlacement.id） */
  images: string[];
}

export interface PdfTable {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: PdfTableCell[][];
}

export interface PdfPageLayout {
  num: number;
  width: number;
  height: number;
  tables: PdfTable[];
  /** 不属于任何表格的文字，保持内容流顺序 */
  freeText: PdfPositionedText[];
  /** 不属于任何表格的图片 */
  freeImages: PdfImagePlacement[];
  /** 页面上全部图片（含落在表格里的），抽图时按此逐一解像素 */
  images: PdfImagePlacement[];
}

/** 比这还小的矩形（pt）不参与网格：装饰线、下划线之类 */
const MIN_GRID_EDGE_PT = 5;
/** 图片在页面上的落幅小于这个尺寸（pt）视为装饰，不抽取 */
export const MIN_IMAGE_EDGE_PT = 24;
/** 一张表至少要这么多格子才当表格，避免把一个带底色的段落框当成表 */
const MIN_TABLE_CELLS = 4;
const MIN_TABLE_ROWS = 2;

const PATH_PAINT_OPS = new Set<number>([
  pdfjs.OPS.stroke,
  pdfjs.OPS.closeStroke,
  pdfjs.OPS.fill,
  pdfjs.OPS.eoFill,
  pdfjs.OPS.fillStroke,
  pdfjs.OPS.eoFillStroke,
  pdfjs.OPS.closeFillStroke,
  pdfjs.OPS.closeEOFillStroke,
]);

type Matrix = number[];

interface PageGeometry {
  store: LineStore;
  paints: PdfImagePaint[];
}

/** 把单位正方形经 CTM 与 viewport 变换后的包围盒算出来（图片就是这样画的） */
function unitSquareBounds(ctm: Matrix, viewportTransform: Matrix): { x: number; y: number; width: number; height: number } {
  const m = pdfjs.Util.transform(viewportTransform, ctm);
  const corners: number[][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  // pdf.js 5 的 applyTransform 原地修改传入的点
  for (const corner of corners) pdfjs.Util.applyTransform(corner, m);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

async function collectGeometry(page: PdfPage): Promise<PageGeometry> {
  const viewport = page.getViewport({ scale: 1 });
  const store = new LineStore();
  const paints: PdfImagePaint[] = [];
  const opList = await page.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | undefined;
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === pdfjs.OPS.transform) {
      ctm = pdfjs.Util.transform(ctm, args as Matrix);
    } else if (fn === pdfjs.OPS.constructPath) {
      const op = typeof args?.[0] === 'number' ? args[0] : 0;
      // 包围盒是 Float32Array（[minX, minY, maxX, maxY]），不是普通数组
      const raw = args?.[2];
      const minMax = ArrayBuffer.isView(raw) || Array.isArray(raw) ? (raw as ArrayLike<number>) : null;
      if (!PATH_PAINT_OPS.has(op) || !minMax || minMax.length < 4 || !Number.isFinite(minMax[0])) continue;
      const width = minMax[2] - minMax[0];
      const height = minMax[3] - minMax[1];
      if (width > MIN_GRID_EDGE_PT && height > MIN_GRID_EDGE_PT) {
        const rect = new Rectangle(new Point(minMax[0], minMax[1]), width, height);
        rect.transform(ctm);
        rect.transform(viewport.transform);
        store.addRectangle(rect);
      } else if ((width > MIN_GRID_EDGE_PT && height === 0) || (width === 0 && height > MIN_GRID_EDGE_PT)) {
        const line = new Line(new Point(minMax[0], minMax[1]), new Point(minMax[2], minMax[3]));
        line.transform(ctm);
        line.transform(viewport.transform);
        store.add(line);
      }
    } else if (fn === pdfjs.OPS.paintImageXObject) {
      // 内联图（paintInlineImageXObject）没有对象名、解不出像素，本版不抽
      if (typeof args?.[0] !== 'string') continue;
      const bounds = unitSquareBounds(ctm, viewport.transform);
      paints.push({ name: args[0], ...bounds });
    }
  }
  return { store, paints };
}

/** 两块绘图的边缘偏差在这个范围内（pt）视为对齐 */
const ALIGN_TOLERANCE_PT = 1.5;
/** 两块绘图之间允许的缝隙（pt）；略微重叠也算相邻 */
const ADJACENT_GAP_PT = 1.5;
const ADJACENT_OVERLAP_PT = 0.5;

function bounds(members: PdfImagePaint[]): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(...members.map((m) => m.x));
  const minY = Math.min(...members.map((m) => m.y));
  const maxX = Math.max(...members.map((m) => m.x + m.width));
  const maxY = Math.max(...members.map((m) => m.y + m.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= ALIGN_TOLERANCE_PT;
}

function touching(endOfFirst: number, startOfSecond: number): boolean {
  const gap = startOfSecond - endOfFirst;
  return gap >= -ADJACENT_OVERLAP_PT && gap <= ADJACENT_GAP_PT;
}

/** 同宽同列、上下相接；或同高同行、左右相接 */
function adjacent(a: PdfImagePaint, b: PdfImagePaint): boolean {
  const sameColumn = near(a.x, b.x) && near(a.width, b.width);
  if (sameColumn && (touching(a.y + a.height, b.y) || touching(b.y + b.height, a.y))) return true;
  const sameRow = near(a.y, b.y) && near(a.height, b.height);
  return sameRow && (touching(a.x + a.width, b.x) || touching(b.x + b.width, a.x));
}

/**
 * 绘图指令 → 页面上的图。整幅绘制的各自成图；被导出器切成条或块分别绘制的，按"对齐且相接"
 * 拼回一张（不预设条有多细——实测同一份文件里既有 0.4pt 的条也有 7pt 的块）。
 * 拼完仍小于阈值的是装饰（分隔线、单元格底纹），丢掉。
 */
export function groupImagePaints(
  paints: PdfImagePaint[],
  pageNum: number,
  /** 容器键：不同容器（如相邻两个单元格）里的绘图即便相接也不拼在一起 */
  containerOf: (paint: PdfImagePaint) => string = () => '',
): PdfImagePlacement[] {
  // 并查集：先按 y 排序，只和纵向邻近的绘图比较，避免整页两两比较
  const sorted = paints.map((paint, index) => ({ paint, index, container: containerOf(paint) })).sort((a, b) => a.paint.y - b.paint.y);
  const parent = paints.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    const reach = a.paint.y + a.paint.height + ADJACENT_GAP_PT;
    for (let j = i + 1; j < sorted.length && sorted[j].paint.y <= reach; j += 1) {
      if (sorted[j].container === a.container && adjacent(a.paint, sorted[j].paint)) union(a.index, sorted[j].index);
    }
  }
  const groups = new Map<number, PdfImagePaint[]>();
  paints.forEach((paint, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(paint);
    groups.set(root, group);
  });

  const placements: PdfImagePlacement[] = [];
  for (const members of groups.values()) {
    const box = bounds(members);
    if (box.width < MIN_IMAGE_EDGE_PT || box.height < MIN_IMAGE_EDGE_PT) continue;
    placements.push({ id: '', ...box, members });
  }
  // 按阅读顺序编号：先上后下、先左后右
  placements.sort((a, b) => a.y - b.y || a.x - b.x);
  placements.forEach((placement, index) => {
    placement.id = `p${pageNum}-${index + 1}`;
  });
  return placements;
}

function tableFromData(data: TableData): PdfTable | null {
  if (!data.check() || data.rowCount < MIN_TABLE_ROWS || data.cellCount < MIN_TABLE_CELLS) return null;
  const rows: PdfTableCell[][] = data.rows.map((row) =>
    row.map((cell) => ({
      x: cell.minXY.x,
      y: cell.minXY.y,
      width: cell.width,
      height: cell.height,
      text: '',
      images: [],
    })),
  );
  return {
    x: data.minXY.x,
    y: data.minXY.y,
    width: data.maxXY.x - data.minXY.x,
    height: data.maxXY.y - data.minXY.y,
    rows,
  };
}

function findCell(table: PdfTable, x: number, y: number): PdfTableCell | null {
  if (x < table.x || y < table.y || x > table.x + table.width || y > table.y + table.height) return null;
  for (const row of table.rows) {
    for (const cell of row) {
      if (x >= cell.x && x <= cell.x + cell.width && y >= cell.y && y <= cell.y + cell.height) return cell;
    }
  }
  return null;
}

/** 文字项越过格线超过这个距离（pt）才尝试切分，避免把贴边的文字误切 */
const CELL_OVERFLOW_TOLERANCE_PT = 3;

/** 估算每个字符的相对宽度：CJK 与全角按 1，其余按 0.55 */
function charAdvance(ch: string): number {
  return /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]/.test(ch) ? 1 : 0.55;
}

/**
 * 文字项跨过了格线 boundaryX，且文字里有空白：按字符宽度估算每个空白的位置，
 * 在最靠近格线的那个空白处切成两项。估算不精确，但只用来决定"归哪一格"，够用。
 */
export function splitAtCellBoundary(
  item: PdfPositionedText,
  boundaryX: number,
): [PdfPositionedText, PdfPositionedText] | null {
  if (item.width <= 0 || boundaryX <= item.x || boundaryX >= item.x + item.width) return null;
  const chars = [...item.text];
  const advances = chars.map(charAdvance);
  const totalAdvance = advances.reduce((sum, value) => sum + value, 0);
  if (totalAdvance <= 0) return null;
  let best: { index: number; x: number } | null = null;
  let cursor = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const startX = item.x + (cursor / totalAdvance) * item.width;
    if (/\s/.test(chars[i]) && i > 0 && i < chars.length - 1) {
      if (!best || Math.abs(startX - boundaryX) < Math.abs(best.x - boundaryX)) best = { index: i, x: startX };
    }
    cursor += advances[i];
  }
  if (!best) return null;
  const leftText = chars.slice(0, best.index).join('');
  const rightText = chars.slice(best.index + 1).join('');
  if (!leftText.trim() || !rightText.trim()) return null;
  const leftWidth = Math.max(0, best.x - item.x);
  return [
    { ...item, text: leftText, width: leftWidth, hasEOL: false },
    { ...item, text: rightText, x: best.x, width: Math.max(0, item.width - leftWidth) },
  ];
}

function toPositionedText(item: TextItem, viewportTransform: Matrix): PdfPositionedText {
  // 与 pdf-parse 相同的坐标变换：先到 viewport，再翻转 y，得到"左上角原点、y 向下"的基线位置
  const tx = pdfjs.Util.transform(pdfjs.Util.transform(viewportTransform, item.transform), [1, 0, 0, -1, 0, 0]);
  return {
    x: tx[4],
    y: tx[5],
    width: item.width,
    height: item.height,
    text: item.str,
    hasEOL: item.hasEOL,
  };
}

/** 分析一页：网格 → 表格，文字与图片各归其位。 */
export async function analyzePdfPage(page: PdfPage): Promise<PdfPageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const { store, paints } = await collectGeometry(page);
  store.normalize();
  const tables = store
    .getTableData()
    .map(tableFromData)
    .filter((table): table is PdfTable => table !== null);

  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const freeText: PdfPositionedText[] = [];
  // 同一格内相邻文字项之间，pdf.js 会给出独立的空白项；格内按内容流顺序拼接即可
  const cellBuffers = new Map<PdfTableCell, string[]>();
  const place = (item: PdfPositionedText) => {
    // 用文字的水平中点找格子：起点常常正好压在格线上，按起点会误归到左边一格
    let cell: PdfTableCell | null = null;
    for (const table of tables) {
      cell = findCell(table, item.x + item.width / 2, item.y);
      if (cell) break;
    }
    if (!cell) {
      freeText.push(item);
      return;
    }
    // 一个文字项横跨了格线（导出器把相邻两格的文字写进了同一段），在最靠近格线的空白处切开
    const overflowsRight = item.x + item.width > cell.x + cell.width + CELL_OVERFLOW_TOLERANCE_PT;
    const overflowsLeft = item.x < cell.x - CELL_OVERFLOW_TOLERANCE_PT;
    const split = overflowsRight
      ? splitAtCellBoundary(item, cell.x + cell.width)
      : overflowsLeft
        ? splitAtCellBoundary(item, cell.x)
        : null;
    if (split) {
      place(split[0]);
      place(split[1]);
      return;
    }
    const buffer = cellBuffers.get(cell) ?? [];
    buffer.push(item.text);
    if (item.hasEOL) buffer.push('\n');
    cellBuffers.set(cell, buffer);
  };
  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    place(toPositionedText(raw, viewport.transform));
  }
  for (const [cell, buffer] of cellBuffers) {
    cell.text = buffer
      .join('')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  // 图片按中心点归格子；相邻格子里的照片会贴边相接，拼接只在同一格子（或自由区域）内进行
  const cellIds = new Map<PdfTableCell, string>();
  tables.forEach((table, t) => {
    table.rows.forEach((row, r) => {
      row.forEach((cell, c) => cellIds.set(cell, `${t}:${r}:${c}`));
    });
  });
  const cellAt = (x: number, y: number): PdfTableCell | null => {
    for (const table of tables) {
      const cell = findCell(table, x, y);
      if (cell) return cell;
    }
    return null;
  };
  const containerOf = (paint: PdfImagePaint): string => {
    const cell = cellAt(paint.x + paint.width / 2, paint.y + paint.height / 2);
    return cell ? cellIds.get(cell) ?? '' : 'free';
  };
  const freeImages: PdfImagePlacement[] = [];
  const images: PdfImagePlacement[] = groupImagePaints(paints, page.pageNumber, containerOf);
  for (const image of images) {
    const cell = cellAt(image.x + image.width / 2, image.y + image.height / 2);
    if (cell) cell.images.push(image.id);
    else freeImages.push(image);
  }

  return {
    num: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    tables,
    freeText,
    freeImages,
    images,
  };
}

export interface PdfTextLine {
  y: number;
  height: number;
  text: string;
}

/**
 * 把自由文字项按内容流顺序组成行：基线变化超过半个字高就换行；同一行内两项之间留有明显
 * 水平间距时补一个空格。刻意不按 y 全局排序——双栏排版按坐标排会把两栏交错在一起。
 */
export function groupTextLines(items: PdfPositionedText[]): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  let current: { y: number; height: number; parts: string[]; endX: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.parts.join('').replace(/[ \t]+/g, ' ').trim();
    if (text) lines.push({ y: current.y, height: current.height, text });
    current = null;
  };

  for (const item of items) {
    const isWhitespace = item.text.trim().length === 0;
    const height: number = item.height > 0 ? item.height : (current ? current.height : 10);
    const sameLine = current !== null && Math.abs(item.y - current.y) <= Math.max(2, height * 0.5);
    if (!sameLine) {
      flush();
      if (isWhitespace) continue;
      current = { y: item.y, height, parts: [item.text], endX: item.x + item.width };
    } else if (current) {
      if (isWhitespace) {
        current.parts.push(' ');
      } else {
        const gap = item.x - current.endX;
        if (gap > height * 0.3 && !current.parts[current.parts.length - 1]?.endsWith(' ')) current.parts.push(' ');
        current.parts.push(item.text);
      }
      current.endX = Math.max(current.endX, item.x + item.width);
      current.height = Math.max(current.height, height);
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

export interface PdfTextParagraph {
  y: number;
  lines: string[];
}

/** 相邻两行的基线间距超过 1.6 倍行高就另起一段；单个换行保留（与 .txt 转换一致）。 */
export function groupParagraphs(lines: PdfTextLine[]): PdfTextParagraph[] {
  const paragraphs: PdfTextParagraph[] = [];
  let current: PdfTextParagraph | null = null;
  let previous: PdfTextLine | null = null;
  for (const line of lines) {
    const gap = previous ? Math.abs(line.y - previous.y) : 0;
    const threshold = Math.max(previous?.height ?? line.height, line.height) * 1.6;
    if (!current || !previous || gap > threshold) {
      current = { y: line.y, lines: [line.text] };
      paragraphs.push(current);
    } else {
      current.lines.push(line.text);
    }
    previous = line;
  }
  return paragraphs;
}

/** 页面上可见（非空白）字符数，用来判断有没有文字层。 */
export function countVisibleChars(layout: PdfPageLayout): number {
  let count = layout.freeText.reduce((sum, item) => sum + item.text.replace(/\s+/g, '').length, 0);
  for (const table of layout.tables) {
    for (const row of table.rows) {
      for (const cell of row) count += cell.text.replace(/\s+/g, '').length;
    }
  }
  return count;
}
