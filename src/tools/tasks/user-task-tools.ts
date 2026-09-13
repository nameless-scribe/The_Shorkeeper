import {
  createUserTask,
  findUserTaskBySource,
  formatUserTaskList,
  getUserTask,
  listUserTasks,
  runUserTaskTransaction,
  updateUserTask,
  type UserTaskStatus,
} from '../../db/user-tasks';
import { notifyUserTasksChanged } from '../../tasks/user-task-events';
import { parseXlsxFile } from '../doc/parse-xlsx';
import { syncUserTaskStatusToXlsx } from '../../tasks/xlsx-task-sync';
import type { ToolDefinition } from '../types';

const STATUS_ALIASES: Record<string, UserTaskStatus> = {
  pending: 'pending',
  待开始: 'pending',
  '⏳ 待开始': 'pending',
  待办: 'pending',
  in_progress: 'in_progress',
  进行中: 'in_progress',
  '🔄 进行中': 'in_progress',
  '🔄 **进行中**': 'in_progress',
  done: 'done',
  已完成: 'done',
  '✅ 已完成': 'done',
  '✅ **已完成**': 'done',
  完成: 'done',
  cancelled: 'cancelled',
  已取消: 'cancelled',
  取消: 'cancelled',
};

export function normalizeImportedTaskStatus(raw: string): UserTaskStatus | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'pending';
  return STATUS_ALIASES[trimmed] ?? STATUS_ALIASES[trimmed.toLowerCase()] ?? null;
}

function normalizeImportedDueAt(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T[\d:.+-]+Z?)?$/);
  if (!match) return undefined;
  const [year, month, day] = match[1].split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return undefined;
  return match[1];
}

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

export const importTasksFromXlsxTool: ToolDefinition = {
  name: 'import_tasks_from_xlsx',
  description:
    '从工作区 Excel (.xlsx) 导入或合并用户待办。自动识别表头中的模块/任务/状态列；同文件同行号已存在则更新。',
  category: 'life',
  requiresPermission: ['filesystem:read'],
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '工作区 .xlsx 相对路径' },
      sheet_name: { type: 'string', description: '工作表名，省略则第一个' },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const { path: filePath, sheet_name } = args as { path?: string; sheet_name?: string };
    if (!filePath?.trim()) {
      return { success: false, output: '', error: '缺少 path 参数' };
    }

    try {
      const parsed = await parseXlsxFile(ctx.workspaceRoot, filePath, {
        sheet_name,
        max_rows: 5000,
      });
      if (!parsed.headers.length) {
        return { success: false, output: '', error: '表格无表头行' };
      }
      if (parsed.has_more) {
        return {
          success: false,
          output: '',
          error: `表格共有 ${parsed.total_rows} 行，超过单次安全导入上限 5000 行；未写入任何待办`,
        };
      }

      const titleCol = pickColumn(parsed.headers, ['任务', '任务名称', '标题', '事项', 'title', 'task']);
      const moduleCol = pickColumn(parsed.headers, ['模块', 'module', '业务模块']);
      const statusCol = pickColumn(parsed.headers, ['状态', '进度', 'status']);
      const dueCol = pickColumn(parsed.headers, ['截止', '日期', 'due', 'deadline']);

      if (titleCol < 0) {
        return {
          success: false,
          output: '',
          error: `无法识别任务列，表头: ${parsed.headers.join(', ')}`,
        };
      }

      const candidates: Array<{
        title: string;
        moduleName: string | null;
        status: UserTaskStatus;
        dueAt: string | null;
        sourceRow: number;
      }> = [];
      const validationErrors: string[] = [];
      for (let i = 0; i < parsed.rows.length; i += 1) {
        const row = parsed.rows[i];
        const title = (row[titleCol] ?? '').trim();
        if (!title) continue;

        const moduleName = moduleCol >= 0 ? (row[moduleCol] ?? '').trim() || null : null;
        const statusRaw = statusCol >= 0 ? row[statusCol] ?? '' : '';
        const status = normalizeImportedTaskStatus(statusRaw);
        const dueRaw = dueCol >= 0 ? row[dueCol] ?? '' : '';
        const dueAt = normalizeImportedDueAt(dueRaw);
        const sourceRow = i + 2;
        if (!status) validationErrors.push(`第 ${sourceRow} 行状态无法识别：${statusRaw}`);
        if (dueAt === undefined) validationErrors.push(`第 ${sourceRow} 行截止日期须为 YYYY-MM-DD：${dueRaw}`);
        if (status && dueAt !== undefined) {
          candidates.push({ title, moduleName, status, dueAt, sourceRow });
        }
      }

      if (validationErrors.length) {
        return {
          success: false,
          output: '',
          error: `导入前校验失败，未写入任何待办：\n${validationErrors.slice(0, 10).join('\n')}${
            validationErrors.length > 10 ? `\n另有 ${validationErrors.length - 10} 项错误` : ''
          }`,
        };
      }

      let created = 0;
      let updated = 0;
      runUserTaskTransaction(() => {
        for (const candidate of candidates) {
          const { title, moduleName, status, dueAt, sourceRow } = candidate;

          const existing = findUserTaskBySource(filePath, sourceRow);
          if (existing) {
            updateUserTask(existing.id, {
              title,
              status,
              module: moduleName,
              dueAt,
              sourceFile: filePath,
              sourceRow,
            });
            updated += 1;
          } else {
            createUserTask({
              title,
              status,
              module: moduleName,
              dueAt,
              sourceFile: filePath,
              sourceRow,
            });
            created += 1;
          }
        }
      });

      const tasks = listUserTasks();
      notifyUserTasksChanged();
      return {
        success: true,
        output: `已从 ${filePath} 导入：新建 ${created}，更新 ${updated}。\n\n${formatUserTaskList(tasks)}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};

export const listUserTasksTool: ToolDefinition = {
  name: 'list_user_tasks',
  description: '列出用户待办任务，可按状态或模块筛选',
  category: 'life',
  requiresPermission: [],
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'done', 'cancelled'],
        description: '按状态筛选',
      },
      module: { type: 'string', description: '按模块名筛选' },
    },
  },
  async execute(args) {
    const { status, module } = args as { status?: UserTaskStatus; module?: string };
    const tasks = listUserTasks({ status, module });
    return { success: true, output: formatUserTaskList(tasks) };
  },
};

export const updateUserTaskTool: ToolDefinition = {
  name: 'update_user_task',
  description: '更新用户待办的状态、备注或截止日期；若任务来自 Excel 且表含状态列，会尝试回写源文件',
  category: 'life',
  requiresPermission: ['filesystem:write'],
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '任务 id' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'done', 'cancelled'],
      },
      title: { type: 'string' },
      notes: { type: 'string' },
      due_at: { type: 'string', description: '截止日期 YYYY-MM-DD' },
      sync_xlsx: {
        type: 'boolean',
        description: '是否回写 Excel 状态列，默认 true（有来源文件时）',
      },
    },
    required: ['id'],
  },
  async execute(args, ctx) {
    const raw = args as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id.trim()) {
      return { success: false, output: '', error: '缺少 id 参数' };
    }

    const existing = getUserTask(id);
    if (!existing) {
      return { success: false, output: '', error: `未找到任务: ${id}` };
    }

    const requestedStatus = typeof raw.status === 'string' ? raw.status : undefined;
    if (requestedStatus && !['pending', 'in_progress', 'done', 'cancelled'].includes(requestedStatus)) {
      return { success: false, output: '', error: `无效状态: ${requestedStatus}` };
    }
    const requestedDueAt = typeof raw.due_at === 'string'
      ? normalizeImportedDueAt(raw.due_at)
      : undefined;
    if (typeof raw.due_at === 'string' && requestedDueAt === undefined) {
      return { success: false, output: '', error: 'due_at 须为 YYYY-MM-DD' };
    }

    const updated = updateUserTask(id, {
      title: typeof raw.title === 'string' ? raw.title : undefined,
      status: requestedStatus as UserTaskStatus | undefined,
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      dueAt: typeof raw.due_at === 'string' ? requestedDueAt : undefined,
    });

    if (!updated) {
      return { success: false, output: '', error: '更新失败' };
    }

    let syncNote = '';
    const shouldSync = raw.sync_xlsx !== false && updated.sourceFile;
    if (shouldSync && updated.sourceFile) {
      try {
        const synced = await syncUserTaskStatusToXlsx(updated.id);
        syncNote = `\n已回写 Excel: ${synced}`;
      } catch (error) {
        updateUserTask(existing.id, {
          title: existing.title,
          status: existing.status,
          notes: existing.notes,
          dueAt: existing.dueAt,
          sourceFile: existing.sourceFile,
          sourceRow: existing.sourceRow,
          module: existing.module,
        });
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          output: '',
          error: `Excel 回写失败，数据库更新已撤销：${message}`,
        };
      }
    }

    notifyUserTasksChanged();
    return {
      success: true,
      output: `已更新任务。\n${formatUserTaskList([updated])}${syncNote}`,
    };
  },
};
