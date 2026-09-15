import { describe, expect, it } from 'vitest';
import { inlineToPlainText, parseInline, parseMarkdown } from '../markdown-ast';

describe('parseInline', () => {
  it('parses bold, italic, code and keeps link text only', () => {
    const nodes = parseInline('前 **粗** *斜* `代码` [官网](https://example.com) 后');
    expect(nodes).toEqual([
      { type: 'text', value: '前 ' },
      { type: 'strong', children: [{ type: 'text', value: '粗' }] },
      { type: 'text', value: ' ' },
      { type: 'emphasis', children: [{ type: 'text', value: '斜' }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: '代码' },
      { type: 'text', value: ' 官网 后' },
    ]);
  });

  it('nests emphasis inside strong', () => {
    expect(parseInline('**加粗里有*斜体***')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: '加粗里有' },
          { type: 'emphasis', children: [{ type: 'text', value: '斜体' }] },
        ],
      },
    ]);
  });

  it('keeps unmatched markers and escaped characters as plain text', () => {
    expect(parseInline('a * b ** c `d')).toEqual([{ type: 'text', value: 'a * b ** c `d' }]);
    expect(parseInline('\\*不是斜体\\* 价格 3\\*4')).toEqual([{ type: 'text', value: '*不是斜体* 价格 3*4' }]);
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', value: '2 * 3 = 6' }]);
  });

  it('does not treat asterisks inside code spans as emphasis', () => {
    expect(parseInline('`a*b` 与 *c*')).toEqual([
      { type: 'code', value: 'a*b' },
      { type: 'text', value: ' 与 ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'c' }] },
    ]);
  });

  it('turns newlines inside a paragraph into soft breaks', () => {
    expect(parseInline('第一行\n第二行')).toEqual([
      { type: 'text', value: '第一行' },
      { type: 'break' },
      { type: 'text', value: '第二行' },
    ]);
  });

  it('flattens nodes back to plain text', () => {
    expect(inlineToPlainText(parseInline('**粗** *斜* `码`\n行'))).toBe('粗 斜 码\n行');
  });
});

describe('parseMarkdown blocks', () => {
  it('parses headings at every level and strips closing hashes', () => {
    const doc = parseMarkdown('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六 ##\n####### 七');
    expect(doc.blocks.slice(0, 6).map((block) => (block.type === 'heading' ? block.level : null))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(doc.blocks[5]).toEqual({ type: 'heading', level: 6, children: [{ type: 'text', value: '六' }] });
    // 七个井号不是标题，按段落原样保留
    expect(doc.blocks[6]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '####### 七' }] });
  });

  it('keeps plain text callers unchanged: blank lines split paragraphs, single newlines stay inside', () => {
    const doc = parseMarkdown('正文段落一\n第二行\n\n正文段落二');
    expect(doc.blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', value: '正文段落一' }, { type: 'break' }, { type: 'text', value: '第二行' }],
      },
      { type: 'paragraph', children: [{ type: 'text', value: '正文段落二' }] },
    ]);
  });

  it('parses unordered and ordered lists with two levels of nesting', () => {
    const doc = parseMarkdown('- 甲\n  1. 甲一\n  2. 甲二\n- 乙\n    - 太深的缩进按第二级\n\n1. 壹\n2. 贰');
    expect(doc.blocks).toHaveLength(2);
    const [first, second] = doc.blocks;
    expect(first).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        {
          children: [{ type: 'text', value: '甲' }],
          sublist: {
            ordered: true,
            items: [{ children: [{ type: 'text', value: '甲一' }] }, { children: [{ type: 'text', value: '甲二' }] }],
          },
        },
        {
          children: [{ type: 'text', value: '乙' }],
          sublist: { ordered: false, items: [{ children: [{ type: 'text', value: '太深的缩进按第二级' }] }] },
        },
      ],
    });
    expect(second).toMatchObject({ type: 'list', ordered: true, items: [{}, {}] });
  });

  it('keeps a loose list together and folds continuation lines into the previous item', () => {
    const doc = parseMarkdown('- 第一项\n  接着写的续行\n\n- 第二项');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({
      type: 'list',
      items: [
        {
          children: [{ type: 'text', value: '第一项' }, { type: 'break' }, { type: 'text', value: '接着写的续行' }],
        },
        { children: [{ type: 'text', value: '第二项' }] },
      ],
    });
  });

  it('parses GFM tables, pads short rows and unescapes pipes', () => {
    const doc = parseMarkdown('| 项目 | 金额 |\n| --- | ---: |\n| 甲 | 12 |\n| 乙 \\| 丙 |\n\n后面的段落');
    expect(doc.blocks[0]).toEqual({
      type: 'table',
      header: [[{ type: 'text', value: '项目' }], [{ type: 'text', value: '金额' }]],
      rows: [
        [[{ type: 'text', value: '甲' }], [{ type: 'text', value: '12' }]],
        [[{ type: 'text', value: '乙 | 丙' }], []],
      ],
    });
    expect(doc.blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '后面的段落' }] });
  });

  it('treats a pipe line without a delimiter row as ordinary text', () => {
    const doc = parseMarkdown('a | b\n第二行');
    expect(doc.blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'a | b' }, { type: 'break' }, { type: 'text', value: '第二行' }],
      },
    ]);
  });

  it('turns horizontal rules into page breaks and accepts CRLF input', () => {
    const doc = parseMarkdown('第一页\r\n\r\n---\r\n\r\n第二页');
    expect(doc.blocks.map((block) => block.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('returns an empty document for empty or whitespace input', () => {
    expect(parseMarkdown('')).toEqual({ blocks: [] });
    expect(parseMarkdown('\n  \n\t\n')).toEqual({ blocks: [] });
  });

  it('never throws on odd input', () => {
    const odd = '|\n|---|\n**\n- \n1.\n#\n```\n[未闭合](\n***斜粗***';
    expect(() => parseMarkdown(odd)).not.toThrow();
  });
});
