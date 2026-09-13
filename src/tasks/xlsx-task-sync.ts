import { getUserTask, type UserTaskInfo } from '../db/user-tasks';
import { parseXlsxFile } from '../tools/doc/parse-xlsx';
import { loadExcelJS } from '../tools/doc/exceljs-loader';
import { writeWorkspaceFileAtomically } from '../tools/file/artifact';
import { resolveWorkspacePath } from '../tools/file/workspace-path';
import { getWorkspaceDir } from '../config/paths';
import path from 'node:path';

function pickColumn(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const name of candidates) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  for (const name of candidates) {
    const idx = lower.findIndex((h) => h.includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function statusLabel(status: UserTaskInfo['status']): string {
  if (status === 'done') return '✅ 已完成';
  if (status === 'in_progress') return '🔄 进行中';
  if (status === 'cancelled') return '已取消';
  return '⏳ 待开始';
}

export async function syncUserTaskStatusToXlsx(taskId: string): Promise<string> {
  const task = getUserTask(taskId);
  if (!task?.sourceFile || task.sourceRow == null) {
    throw new Error('任务没有可回写的 Excel 来源');
  }

  const workspaceRoot = path.resolve(getWorkspaceDir());
  const parsed = await parseXlsxFile(workspaceRoot, task.sourceFile, { max_rows: 5000 });
  const statusCol = pickColumn(parsed.headers, ['状态', '进度', 'status']);
  if (statusCol < 0) throw new Error('来源 Excel 没有状态/进度列');

  const rowIndex = task.sourceRow - 2;
  if (rowIndex < 0 || rowIndex >= parsed.rows.length) throw new Error('来源行已移动或超出可读取范围');

  const absolute = resolveWorkspacePath(workspaceRoot, task.sourceFile);
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolute);
  const sheet = workbook.getWorksheet(parsed.sheet) ?? workbook.worksheets[0];
  if (!sheet) throw new Error('来源工作表不存在');

  const excelRow = sheet.getRow(task.sourceRow);
  excelRow.getCell(statusCol + 1).value = statusLabel(task.status);
  excelRow.commit();
  await writeWorkspaceFileAtomically(
    workspaceRoot,
    task.sourceFile,
    (temporaryPath) => workbook.xlsx.writeFile(temporaryPath),
    { preserveBackup: true },
  );
  return task.sourceFile;
}
