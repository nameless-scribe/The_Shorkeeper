import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
} from 'docx';
import { closeDatabase, initDatabase } from '../src/db/index';
import { listUserTasks } from '../src/db/user-tasks';
import { discoverSkills, invalidateSkillsCache } from '../src/skills/loader';
import { resolveActiveSkillsWithDiagnostics } from '../src/skills/resolve';
import { convertToMarkdownTool } from '../src/tools/doc/convert-markdown';
import { loadExcelJS } from '../src/tools/doc/exceljs-loader';
import { readXlsxTool, updateXlsxCellsTool } from '../src/tools/doc/gen-tools';
import { readFileTool } from '../src/tools/file/read-file';
import { replaceTextTool } from '../src/tools/file/replace-text';
import { importTasksFromXlsxTool, updateUserTaskTool } from '../src/tools/tasks/user-task-tools';

interface AcceptanceCase {
  name: string;
  durationMs: number;
  assertions: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function digest(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function runCase(
  name: string,
  operation: () => Promise<number>,
): Promise<AcceptanceCase> {
  const startedAt = Date.now();
  const assertions = await operation();
  return { name, durationMs: Date.now() - startedAt, assertions };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorekeeper-skill-acceptance-'));
  const resolvedRoot = path.resolve(root);
  const resolvedTemp = path.resolve(os.tmpdir());
  assert(
    resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) &&
      path.basename(resolvedRoot).startsWith('shorekeeper-skill-acceptance-'),
    `拒绝使用不安全的验收目录：${resolvedRoot}`,
  );

  process.env.SHOREKEEPER_WORKSPACE_DIR = root;
  const context = {
    sessionId: 'skill-acceptance',
    workspaceRoot: root,
    signal: new AbortController().signal,
  };
  const cases: AcceptanceCase[] = [];

  try {
    await initDatabase(path.join(root, 'acceptance.db'));

    cases.push(await runCase('大型文本分段读取与精确替换', async () => {
      const original = `${'x'.repeat(110_000)}\n唯一验收标记\n结尾`;
      await fs.writeFile(path.join(root, 'large.md'), original, 'utf8');
      const full = await readFileTool.execute({ path: 'large.md' }, context);
      assert(!full.success && full.error?.includes('分段读取'), '大型文件全文读取应被拒绝');
      const ranged = await readFileTool.execute(
        { path: 'large.md', start_line: 2, end_line: 2 },
        context,
      );
      assert(ranged.success && ranged.output === '唯一验收标记', '行范围读取结果不正确');
      const replaced = await replaceTextTool.execute(
        { path: 'large.md', old_text: '唯一验收标记', new_text: '已安全替换' },
        context,
      );
      assert(replaced.success, `精确替换失败：${replaced.error ?? ''}`);
      const finalText = await fs.readFile(path.join(root, 'large.md'), 'utf8');
      assert(finalText.includes('已安全替换') && !finalText.includes('唯一验收标记'), '替换结果不正确');
      return 4;
    }));

    cases.push(await runCase('DOCX 常见结构转 Markdown', async () => {
      const document = new Document({
        sections: [{
          children: [
            new Paragraph({ text: '验收标题', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: '正文段落' }),
            new Paragraph({ text: '列表项目', bullet: { level: 0 } }),
            new Table({
              rows: [
                new TableRow({ children: [new TableCell({ children: [new Paragraph('名称')] }), new TableCell({ children: [new Paragraph('状态')] })] }),
                new TableRow({ children: [new TableCell({ children: [new Paragraph('Skill')] }), new TableCell({ children: [new Paragraph('通过')] })] }),
              ],
            }),
          ],
        }],
      });
      await fs.writeFile(path.join(root, 'structured.docx'), await Packer.toBuffer(document));
      const converted = await convertToMarkdownTool.execute({ source_path: 'structured.docx' }, context);
      assert(converted.success, `DOCX 转换失败：${converted.error ?? ''}`);
      const markdown = await fs.readFile(path.join(root, 'structured.md'), 'utf8');
      assert(markdown.includes('# 验收标题'), '标题结构未保留');
      assert(markdown.includes('- 列表项目'), '列表结构未保留');
      assert(markdown.includes('| 名称 | 状态 |') && markdown.includes('| Skill | 通过 |'), '表格结构未保留');
      return 4;
    }));

    cases.push(await runCase('复杂 Excel 分页与保结构修改', async () => {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const main = workbook.addWorksheet('Main');
      main.addRow(['编号', '结果', '状态']);
      for (let index = 1; index <= 620; index += 1) {
        main.addRow([index, { formula: `${index}+1`, result: index + 1 }, '待处理']);
      }
      main.getCell('B2').font = { bold: true, color: { argb: 'FFFF0000' } };
      workbook.addWorksheet('Archive').getCell('A1').value = '必须保留';
      await workbook.xlsx.writeFile(path.join(root, 'complex.xlsx'));

      const page = await readXlsxTool.execute(
        { path: 'complex.xlsx', sheet_name: 'Main', start_row: 500, max_rows: 100 },
        context,
      );
      assert(page.success, `Excel 分页读取失败：${page.error ?? ''}`);
      const parsed = JSON.parse(page.output) as { returned_rows: number; has_more: boolean };
      assert(parsed.returned_rows === 100 && parsed.has_more, 'Excel 分页元数据不正确');

      const before = await fs.readFile(path.join(root, 'complex.xlsx'));
      const rejected = await updateXlsxCellsTool.execute(
        { source_path: 'complex.xlsx', updates: [{ cell: 'NOT-A-CELL', value: 'x' }] },
        context,
      );
      assert(!rejected.success, '无效单元格地址应在写入前拒绝');
      assert(digest(before) === digest(await fs.readFile(path.join(root, 'complex.xlsx'))), '拒绝写入时工作簿发生变化');

      const updated = await updateXlsxCellsTool.execute(
        { source_path: 'complex.xlsx', sheet_name: 'Main', updates: [{ cell: 'C2', value: '完成' }] },
        context,
      );
      assert(updated.success, `Excel 修改失败：${updated.error ?? ''}`);
      const verified = new ExcelJS.Workbook();
      await verified.xlsx.readFile(path.join(root, 'complex.xlsx'));
      assert(verified.getWorksheet('Main')?.getCell('C2').value === '完成', '目标单元格未更新');
      assert(typeof verified.getWorksheet('Main')?.getCell('B2').value === 'object', '公式被破坏');
      assert(verified.getWorksheet('Main')?.getCell('B2').font.bold, '样式被破坏');
      assert(verified.getWorksheet('Archive')?.getCell('A1').value === '必须保留', '其他工作表被破坏');
      return 9;
    }));

    cases.push(await runCase('待办导入、校验与 Excel 一致性', async () => {
      const ExcelJS = await loadExcelJS();
      const invalidBook = new ExcelJS.Workbook();
      const invalidSheet = invalidBook.addWorksheet('Tasks');
      invalidSheet.addRow(['任务', '状态', '截止']);
      invalidSheet.addRow(['错误任务', '未知状态', '明天']);
      await invalidBook.xlsx.writeFile(path.join(root, 'invalid-tasks.xlsx'));
      const rejected = await importTasksFromXlsxTool.execute({ path: 'invalid-tasks.xlsx' }, context);
      assert(!rejected.success && listUserTasks().length === 0, '非法待办导入产生了部分数据');

      const validBook = new ExcelJS.Workbook();
      const validSheet = validBook.addWorksheet('Tasks');
      validSheet.addRow(['任务', '状态', '截止', '计算']);
      validSheet.addRow(['发布验收', '待开始', '2026-09-30', { formula: '1+1', result: 2 }]);
      await validBook.xlsx.writeFile(path.join(root, 'tasks.xlsx'));
      const imported = await importTasksFromXlsxTool.execute({ path: 'tasks.xlsx' }, context);
      assert(imported.success && listUserTasks().length === 1, '合法待办未完整导入');
      const task = listUserTasks()[0];
      const updated = await updateUserTaskTool.execute({ id: task.id, status: 'done' }, context);
      assert(updated.success && listUserTasks()[0].status === 'done', '待办数据库状态未更新');
      const verified = new ExcelJS.Workbook();
      await verified.xlsx.readFile(path.join(root, 'tasks.xlsx'));
      assert(verified.getWorksheet('Tasks')?.getCell('B2').value === '✅ 已完成', 'Excel 状态未同步');
      assert(typeof verified.getWorksheet('Tasks')?.getCell('D2').value === 'object', '同步状态时破坏了公式');
      return 5;
    }));

    cases.push(await runCase('Skill 路由正向与误触发', async () => {
      invalidateSkillsCache();
      const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
      assert(skills.length === 5 && skills.every((skill) => skill.validationErrors.length === 0), '产品 Skill 配置未全部通过');
      const ordinaryReport = resolveActiveSkillsWithDiagnostics(
        '[用户已上传以下文件到工作区]\n- sales.xlsx → 工作区: sales.xlsx\n\n请分析销售报表' +
          '\n\n[工作区附件已解析]\n数据行:[["导入待办"]]',
        skills,
      );
      assert(ordinaryReport.activeSkills.some((skill) => skill.id === 'excel'), 'Excel 能力未按附件激活');
      assert(!ordinaryReport.activeSkills.some((skill) => skill.id === 'progress-tracker'), '附件正文误触发待办 Skill');
      const complexTask = resolveActiveSkillsWithDiagnostics('请按多步任务分阶段完成这些文件处理', skills);
      assert(complexTask.activeSkills.some((skill) => skill.id === 'task-execution'), '复杂任务未激活执行 Skill');
      const simpleTask = resolveActiveSkillsWithDiagnostics('分析一下这句话', skills);
      assert(!simpleTask.activeSkills.some((skill) => skill.id === 'task-execution'), '简单分析误触发执行 Skill');
      return 5;
    }));

    console.log(JSON.stringify({
      ok: true,
      workspace: 'isolated-temporary-directory',
      caseCount: cases.length,
      assertionCount: cases.reduce((sum, item) => sum + item.assertions, 0),
      cases,
    }, null, 2));
  } finally {
    closeDatabase();
    delete process.env.SHOREKEEPER_WORKSPACE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[skill-acceptance] 失败：', error);
  process.exitCode = 1;
});
