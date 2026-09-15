import { describe, expect, it } from 'vitest';
import { applyDocxTextEdits, DocxTextEditError, listDocxParagraphTexts } from '../docx-text-edit';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function run(text: string, props = ''): string {
  return `<w:r>${props}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(inner: string, props = ''): string {
  return `<w:p>${props}${inner}</w:p>`;
}

function document(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

const BOLD = '<w:rPr><w:b/></w:rPr>';

describe('applyDocxTextEdits', () => {
  it('replaces text that spans several runs, keeping the first run style and the other run nodes', () => {
    const xml = document(
      paragraph(run('交付日期为 ') + run('9 月 15', BOLD) + run(' 日，请知悉。')) + paragraph(run('第二段')),
    );
    const result = applyDocxTextEdits(xml, [{ find: '9 月 15 日', replace: '9 月 30 日' }]);
    expect(result.edits).toEqual([{ find: '9 月 15 日', replace: '9 月 30 日', occurrence: 'first', replaced: 1 }]);
    expect(result.changes).toEqual([{ paragraph: 1, before: '交付日期为 9 月 15 日，请知悉。', after: '交付日期为 9 月 30 日，请知悉。' }]);
    // 替换文本写进第一个命中的 run（加粗的那个），第三个 run 只删掉命中的部分，节点与 rPr 都还在
    expect(result.xml).toContain(`<w:r>${BOLD}<w:t xml:space="preserve">9 月 30 日</w:t></w:r>`);
    expect(result.xml).toContain('<w:r><w:t xml:space="preserve">，请知悉。</w:t></w:r>');
    expect(result.xml).toContain('<w:r><w:t xml:space="preserve">交付日期为 </w:t></w:r>');
    expect(result.xml).toContain(paragraph(run('第二段')));
    expect(listDocxParagraphTexts(result.xml)).toEqual(['交付日期为 9 月 30 日，请知悉。', '第二段']);
  });

  it('replaces only the first hit by default and every hit with occurrence: all', () => {
    const xml = document(paragraph(run('甲方、甲方代表')) + paragraph(run('甲方签字')));
    const first = applyDocxTextEdits(xml, [{ find: '甲方', replace: '乙方' }]);
    expect(first.edits[0].replaced).toBe(1);
    expect(listDocxParagraphTexts(first.xml)).toEqual(['乙方、甲方代表', '甲方签字']);

    const all = applyDocxTextEdits(xml, [{ find: '甲方', replace: '乙方', occurrence: 'all' }]);
    expect(all.edits[0].replaced).toBe(3);
    expect(all.changes.map((change) => change.after)).toEqual(['乙方、乙方代表', '乙方签字']);
  });

  it('edits text inside table cells and leaves the table structure untouched', () => {
    const table = `<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/>${paragraph(run('数量：'), '<w:pPr><w:jc w:val="center"/></w:pPr>')}</w:tc><w:tc>${paragraph(run('12'))}</w:tc></w:tr></w:tbl>`;
    const xml = document(paragraph(run('表格如下')) + table);
    const result = applyDocxTextEdits(xml, [{ find: '12', replace: '15' }]);
    expect(result.changes).toEqual([{ paragraph: 3, before: '12', after: '15' }]);
    expect(result.xml).toContain('<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/>');
    expect(result.xml).toContain('<w:pPr><w:jc w:val="center"/></w:pPr>');
    expect(result.xml.replace('15', '12')).toBe(xml.replace('<w:t xml:space="preserve">12', '<w:t xml:space="preserve">12'));
  });

  it('applies edits in order so a later edit can see an earlier replacement', () => {
    const xml = document(paragraph(run('版本 v1')));
    const result = applyDocxTextEdits(xml, [
      { find: 'v1', replace: 'v2' },
      { find: '版本 v2', replace: '版本 v2（终稿）' },
    ]);
    expect(result.changes).toEqual([{ paragraph: 1, before: '版本 v1', after: '版本 v2（终稿）' }]);
  });

  it('encodes XML specials in the replacement and decodes entities in the source', () => {
    const xml = document(paragraph(run('A &amp; B &lt; C')));
    const result = applyDocxTextEdits(xml, [{ find: 'A & B', replace: '<X> & "Y"' }]);
    expect(result.changes[0].after).toBe('<X> & "Y" < C');
    expect(result.xml).toContain('<w:t xml:space="preserve">&lt;X&gt; &amp; "Y" &lt; C</w:t>');
  });

  it('skips field-code paragraphs and text boxes, and leaves tab stops out of the paragraph text', () => {
    const field = paragraph('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('第 1 页') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
    const box = paragraph(`<w:r><mc:AlternateContent><w:txbxContent>${paragraph(run('第 1 页 文本框'))}</w:txbxContent></mc:AlternateContent></w:r>`);
    const tabbed = paragraph(run('第 1 页'), '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>');
    const xml = document(field + box + tabbed);
    expect(listDocxParagraphTexts(xml)).toEqual(['', '', '第 1 页']);
    const result = applyDocxTextEdits(xml, [{ find: '第 1 页', replace: '首页', occurrence: 'all' }]);
    expect(result.edits[0].replaced).toBe(1);
    expect(result.changes).toEqual([{ paragraph: 3, before: '第 1 页', after: '首页' }]);
    expect(result.xml).toContain('<w:instrText>PAGE</w:instrText>');
    expect(result.xml).toContain('第 1 页 文本框');
  });

  it('treats <w:tab/> and <w:br/> as barriers that a hit can never cross', () => {
    const xml = document(paragraph(run('姓名') + '<w:r><w:tab/></w:r>' + run('张三') + '<w:r><w:br/></w:r>' + run('张三丰')));
    expect(listDocxParagraphTexts(xml)).toEqual(['姓名\t张三\n张三丰']);
    expect(() => applyDocxTextEdits(xml, [{ find: '姓名\t张三', replace: 'x' }])).toThrow(/换行或制表符/);
    const result = applyDocxTextEdits(xml, [{ find: '张三', replace: '李四', occurrence: 'all' }]);
    expect(result.changes[0].after).toBe('姓名\t李四\n李四丰');
    expect(result.xml).toContain('<w:r><w:tab/></w:r>');
    expect(result.xml).toContain('<w:r><w:br/></w:r>');
  });

  it('rejects documents with tracked changes and never matches table border names that look alike', () => {
    const tracked = document(paragraph(run('正文') + '<w:ins w:id="1" w:author="A"><w:r><w:t>新增</w:t></w:r></w:ins>'));
    expect(() => applyDocxTextEdits(tracked, [{ find: '正文', replace: 'x' }])).toThrow(DocxTextEditError);
    expect(() => applyDocxTextEdits(tracked, [{ find: '正文', replace: 'x' }])).toThrow(/修订记录/);

    const borders = document(
      `<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc>${paragraph(run('正文'))}</w:tc></w:tr></w:tbl>`,
    );
    expect(applyDocxTextEdits(borders, [{ find: '正文', replace: '改后' }]).changes[0].after).toBe('改后');
  });

  it('refuses when any edit matches nothing, cross-paragraph finds included, and validates arguments', () => {
    const xml = document(paragraph(run('第一段')) + paragraph(run('第二段')));
    expect(() => applyDocxTextEdits(xml, [{ find: '第一段第二段', replace: 'x' }])).toThrow(/找不到/);
    expect(() => applyDocxTextEdits(xml, [{ find: '第一段\n第二段', replace: 'x' }])).toThrow(/跨段落/);
    expect(() => applyDocxTextEdits(xml, [{ find: '第一段', replace: 'x' }, { find: '没有的', replace: 'y' }])).toThrow(/没有的/);
    expect(() => applyDocxTextEdits(xml, [])).toThrow(/非空/);
    expect(() => applyDocxTextEdits(xml, [{ find: '', replace: 'x' }])).toThrow(/不能为空/);
    expect(() => applyDocxTextEdits(xml, [{ find: 'a', replace: 'b', occurrence: 'twice' as 'first' }])).toThrow(/occurrence/);
    const many = Array.from({ length: 201 }, () => ({ find: 'a', replace: 'b' }));
    expect(() => applyDocxTextEdits(xml, many)).toThrow(/最多 200/);
  });

  it('handles empty and self-closing text nodes and paragraphs', () => {
    const xml = document('<w:p/>' + paragraph('<w:r><w:t/></w:r>' + run('有字') + '<w:r><w:t xml:space="preserve"></w:t></w:r>') + '<w:p w:rsidR="00AA"/>');
    expect(listDocxParagraphTexts(xml)).toEqual(['', '有字', '']);
    const result = applyDocxTextEdits(xml, [{ find: '有字', replace: '' }]);
    expect(result.changes).toEqual([{ paragraph: 2, before: '有字', after: '' }]);
    expect(result.xml).toContain('<w:r><w:t/></w:r>');
  });
});
