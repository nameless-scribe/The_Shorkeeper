import { describe, expect, it } from 'vitest';
import {
  countVisibleChars,
  groupImagePaints,
  groupParagraphs,
  groupTextLines,
  splitAtCellBoundary,
  type PdfImagePaint,
  type PdfPageLayout,
  type PdfPositionedText,
} from '../pdf-layout';
import { renderPdfPageMarkdown, renderPdfTableMarkdown } from '../pdf-markdown';

function text(x: number, y: number, value: string, extra: Partial<PdfPositionedText> = {}): PdfPositionedText {
  return { x, y, width: value.length * 6, height: 12, text: value, hasEOL: false, ...extra };
}

describe('groupTextLines', () => {
  it('joins items on the same baseline and breaks on baseline changes', () => {
    const lines = groupTextLines([
      text(50, 100, '合同'),
      text(62, 100, ' ', { width: 20, height: 0 }),
      text(82, 100, '编号'),
      text(50, 116, '第二行'),
    ]);
    expect(lines.map((line) => line.text)).toEqual(['合同 编号', '第二行']);
  });

  it('inserts a space for a visible horizontal gap and drops whitespace-only lines', () => {
    const lines = groupTextLines([
      text(50, 100, 'Mitutoyo'),
      text(140, 100, '7106'),
      text(50, 130, '   ', { width: 30 }),
    ]);
    expect(lines.map((line) => line.text)).toEqual(['Mitutoyo 7106']);
  });

  it('keeps content-stream order instead of sorting by y (two-column layouts)', () => {
    const lines = groupTextLines([
      text(50, 100, '左栏一'),
      text(50, 116, '左栏二'),
      text(300, 100, '右栏一'),
    ]);
    expect(lines.map((line) => line.text)).toEqual(['左栏一', '左栏二', '右栏一']);
  });
});

describe('groupParagraphs', () => {
  it('starts a new paragraph after a gap larger than 1.6 line heights', () => {
    const paragraphs = groupParagraphs([
      { y: 100, height: 12, text: 'a' },
      { y: 116, height: 12, text: 'b' },
      { y: 150, height: 12, text: 'c' },
    ]);
    expect(paragraphs.map((p) => p.lines)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('splitAtCellBoundary', () => {
  it('splits a text item that crosses a cell edge at the whitespace nearest the edge', () => {
    // "KBT-13.A 3000*2000*1300"：起点在型号列，右半截在行程列
    const item: PdfPositionedText = { x: 280, y: 126, width: 122, height: 11, text: 'KBT-13.A 3000*2000*1300', hasEOL: true };
    const split = splitAtCellBoundary(item, 339);
    expect(split).not.toBeNull();
    const [left, right] = split!;
    expect(left.text).toBe('KBT-13.A');
    expect(right.text).toBe('3000*2000*1300');
    expect(left.hasEOL).toBe(false);
    expect(right.hasEOL).toBe(true);
    expect(right.x).toBeGreaterThan(left.x + left.width - 1);
    expect(left.width + right.width).toBeCloseTo(item.width, 5);
  });

  it('leaves items alone when they have no whitespace or the edge is outside them', () => {
    const noSpace: PdfPositionedText = { x: 280, y: 126, width: 122, height: 11, text: 'KBT-13.A3000*2000*1300', hasEOL: false };
    expect(splitAtCellBoundary(noSpace, 339)).toBeNull();
    const withSpace: PdfPositionedText = { ...noSpace, text: 'KBT-13.A 3000' };
    expect(splitAtCellBoundary(withSpace, 500)).toBeNull();
    expect(splitAtCellBoundary(withSpace, 200)).toBeNull();
  });

  it('does not stitch paints from different containers even when they touch', () => {
    const paints: PdfImagePaint[] = [
      { name: 'row1', x: 25, y: 100, width: 120, height: 80 },
      { name: 'row2', x: 25, y: 180, width: 120, height: 80 },
    ];
    expect(groupImagePaints(paints, 1)).toHaveLength(1);
    expect(groupImagePaints(paints, 1, (paint) => paint.name)).toHaveLength(2);
  });
});

describe('groupImagePaints', () => {
  const strip = (name: string, y: number): PdfImagePaint => ({ name, x: 25.2, y, width: 135, height: 0.4 });

  it('keeps whole images, stitches contiguous strips and drops decorations', () => {
    const paints: PdfImagePaint[] = [
      { name: 'photo', x: 300, y: 50, width: 120, height: 90 },
      { name: 'divider', x: 20, y: 400, width: 500, height: 1 },
      { name: 'icon', x: 10, y: 10, width: 8, height: 8 },
      ...Array.from({ length: 120 }, (_, i) => strip(`s${i}`, 200 + i * 0.4)),
    ];
    const placements = groupImagePaints(paints, 1);
    expect(placements.map((p) => p.id)).toEqual(['p1-1', 'p1-2']);
    expect(placements[0]).toMatchObject({ x: 300, y: 50, width: 120, height: 90 });
    expect(placements[0].members).toHaveLength(1);
    expect(placements[1].members).toHaveLength(120);
    expect(placements[1].x).toBeCloseTo(25.2);
    expect(placements[1].y).toBeCloseTo(200);
    expect(placements[1].height).toBeCloseTo(48, 0);
  });

  it('splits strips into separate images when there is a gap between runs', () => {
    const paints = [
      ...Array.from({ length: 80 }, (_, i) => strip(`a${i}`, 100 + i * 0.4)),
      ...Array.from({ length: 80 }, (_, i) => strip(`b${i}`, 200 + i * 0.4)),
    ];
    const placements = groupImagePaints(paints, 2);
    expect(placements).toHaveLength(2);
    expect(placements.map((p) => p.id)).toEqual(['p2-1', 'p2-2']);
  });
});

describe('renderPdfPageMarkdown', () => {
  const layout: PdfPageLayout = {
    num: 3,
    width: 595,
    height: 842,
    tables: [
      {
        x: 40,
        y: 200,
        width: 500,
        height: 120,
        rows: [
          [{ x: 40, y: 200, width: 500, height: 30, text: '设备清单', images: [] }],
          [
            { x: 40, y: 230, width: 100, height: 45, text: '图片', images: [] },
            { x: 140, y: 230, width: 200, height: 45, text: '名称', images: [] },
            { x: 340, y: 230, width: 200, height: 45, text: '备注 | 说明', images: [] },
          ],
          [
            { x: 40, y: 275, width: 100, height: 45, text: '', images: ['p3-1'] },
            { x: 140, y: 275, width: 200, height: 45, text: '三坐标\n测量机', images: [] },
            { x: 340, y: 275, width: 200, height: 45, text: '', images: [] },
          ],
        ],
      },
    ],
    freeText: [text(40, 120, '标题在表格上面'), text(40, 400, '结尾在表格下面')],
    freeImages: [{ id: 'p3-2', x: 40, y: 500, width: 200, height: 100, members: [] }],
    images: [],
  };

  it('orders paragraphs, table and images by vertical position and links extracted images', () => {
    const refs = new Map([
      ['p3-1', 'doc.assets/p3-1.jpg'],
      ['p3-2', 'doc.assets/p3-2.jpg'],
    ]);
    const markdown = renderPdfPageMarkdown(layout, refs);
    expect(markdown).toBe(
      [
        '标题在表格上面',
        '',
        '**设备清单**',
        '',
        '| 图片 | 名称 | 备注 \\| 说明 |',
        '| --- | --- | --- |',
        '| ![第 3 页图 1](doc.assets/p3-1.jpg) | 三坐标<br>测量机 |  |',
        '',
        '结尾在表格下面',
        '',
        '![第 3 页图 2](doc.assets/p3-2.jpg)',
      ].join('\n'),
    );
  });

  it('leaves a placeholder for images that were not extracted', () => {
    const markdown = renderPdfPageMarkdown(layout, new Map());
    expect(markdown).toContain('| （第 3 页图 1，未抽取） | 三坐标<br>测量机 |  |');
    expect(markdown).toContain('（第 3 页图 2，未抽取）');
  });

  it('renders caption-only tables as bold paragraphs', () => {
    const markdown = renderPdfTableMarkdown(
      { x: 0, y: 0, width: 100, height: 20, rows: [[{ x: 0, y: 0, width: 100, height: 20, text: '只有标题', images: [] }]] },
      new Map(),
      1,
      () => 1,
    );
    expect(markdown).toBe('**只有标题**');
  });

  it('counts visible characters across free text and cells', () => {
    expect(countVisibleChars(layout)).toBe('标题在表格上面结尾在表格下面'.length + '设备清单图片名称备注|说明三坐标测量机'.length);
  });
});
