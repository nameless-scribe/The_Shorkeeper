import {
  createBookkeepingEntry,
  listBookkeepingEntries,
  type BookkeepingEntry,
  type BookkeepingEntryType,
} from '../../db/repositories/bookkeeping';
import type { ToolDefinition } from '../types';
import { LOCAL_APPEND_CONTRACT } from '../contract';

function formatSummary(rows: BookkeepingEntry[]): string {
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.entryType === 'income') income += row.amount;
    else expense += row.amount;
  }
  return `收入合计：${income.toFixed(2)} CNY\n支出合计：${expense.toFixed(2)} CNY\n结余：${(income - expense).toFixed(2)} CNY\n记录数：${rows.length}`;
}

export const bookkeepingTool: ToolDefinition = {
  name: 'bookkeeping',
  description: '个人记账：添加收支记录、列出最近记录、汇总统计',
  category: 'life',
  requiresPermission: [],
  // add 会追加记录；list/summary 只读，按参数覆盖为只读契约，避免被当成重复副作用合并。
  sideEffects: LOCAL_APPEND_CONTRACT,
  describeCall(args) {
    const action = args && typeof args === 'object' ? (args as { action?: unknown }).action : undefined;
    return action === 'add' ? {} : { risk: 'read', idempotent: true, reversible: 'none' };
  },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'summary'],
        description: 'add=添加记录，list=最近记录，summary=汇总',
      },
      entry_type: {
        type: 'string',
        enum: ['income', 'expense'],
        description: 'add 时必填：income 或 expense',
      },
      amount: { type: 'number', description: '金额（正数）' },
      category: { type: 'string', description: '分类，如 餐饮、交通' },
      note: { type: 'string', description: '备注' },
      limit: { type: 'number', description: 'list 时返回条数，默认 20' },
    },
    required: ['action'],
  },
  async execute(args, ctx) {
    const { action, entry_type, amount, category, note, limit = 20 } = args as {
      action?: string;
      entry_type?: BookkeepingEntryType;
      amount?: number;
      category?: string;
      note?: string;
      limit?: number;
    };

    if (action === 'add') {
      if (!entry_type || amount == null || amount <= 0) {
        return { success: false, output: '', error: 'add 需要 entry_type 与正数 amount' };
      }

      createBookkeepingEntry({
        sessionId: ctx.sessionId,
        category: category ?? '未分类',
        amount,
        note,
        entryType: entry_type,
      });

      return {
        success: true,
        output: `已记录${entry_type === 'income' ? '收入' : '支出'} ${amount.toFixed(2)} CNY（${category || '未分类'}）`,
      };
    }

    if (action === 'list') {
      const rows = listBookkeepingEntries(Math.min(Math.max(limit, 1), 100));
      if (!rows.length) {
        return { success: true, output: '暂无记账记录' };
      }
      const lines = rows.map((r) => {
        const kind = r.entryType === 'income' ? '收入' : '支出';
        const date = new Date(r.createdAt).toLocaleString('zh-CN');
        return `- [${date}] ${kind} ${r.amount.toFixed(2)} ${r.currency} · ${r.category}${r.note ? ` · ${r.note}` : ''}`;
      });
      return { success: true, output: lines.join('\n') };
    }

    if (action === 'summary') {
      const rows = listBookkeepingEntries(500);
      return { success: true, output: formatSummary(rows) };
    }

    return { success: false, output: '', error: `未知 action: ${action}` };
  },
};
