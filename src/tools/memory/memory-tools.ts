import type { ToolDefinition } from '../types';
import { searchMemories, saveMemory, upsertMemory, formatMemoriesForPrompt } from '../../memory/long-term';
import { searchWorldbook, formatWorldbookForPrompt } from '../../memory/worldbook';

export const recallMemoryTool: ToolDefinition = {
  name: 'recall_memory',
  description: '按关键词检索长期记忆，用于回忆用户偏好、习惯或过往重要事实',
  category: 'memory',
  requiresPermission: [],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词或短语',
      },
      limit: {
        type: 'number',
        description: '最多返回条数，默认 5',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const { query, limit } = args as { query?: string; limit?: number };
    if (!query?.trim()) {
      return { success: false, output: '', error: '缺少 query 参数' };
    }

    const memories = searchMemories(query, limit ?? 5);
    if (!memories.length) {
      return { success: true, output: '未找到相关长期记忆。' };
    }

    const formatted = formatMemoriesForPrompt(memories);
    return { success: true, output: formatted ?? '' };
  },
};

export const searchWorldbookTool: ToolDefinition = {
  name: 'search_worldbook',
  description: '搜索世界观 / 角色背景设定（Worldbook）条目',
  category: 'memory',
  requiresPermission: [],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      limit: {
        type: 'number',
        description: '最多返回条数，默认 5',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const { query, limit } = args as { query?: string; limit?: number };
    if (!query?.trim()) {
      return { success: false, output: '', error: '缺少 query 参数' };
    }

    const entries = searchWorldbook(query, limit ?? 5);
    if (!entries.length) {
      return { success: true, output: '未找到相关 Worldbook 条目。' };
    }

    const formatted = formatWorldbookForPrompt(entries);
    return { success: true, output: formatted ?? '' };
  },
};

export const saveMemoryTool: ToolDefinition = {
  name: 'save_memory',
  description: '将值得长期记住的用户相关事实写入记忆库',
  category: 'memory',
  requiresPermission: [],
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '要记住的事实描述',
      },
      key: {
        type: 'string',
        description:
          '记忆键，如 user.nickname、user.preference.drink；同一 key 会更新而非重复插入',
      },
      importance: {
        type: 'number',
        description: '重要程度 0-1，默认 0.6',
      },
    },
    required: ['content'],
  },
  async execute(args, ctx) {
    const { content, importance, key } = args as {
      content?: string;
      importance?: number;
      key?: string;
    };
    if (!content?.trim()) {
      return { success: false, output: '', error: '缺少 content 参数' };
    }

    if (key?.trim()) {
      const entry = upsertMemory(key.trim(), content, importance ?? 0.6, ctx.sessionId);
      return { success: true, output: `已保存记忆 [${entry.memoryKey}]：${entry.content}` };
    }

    const entry = saveMemory(content, importance ?? 0.6, ctx.sessionId);
    if (!entry) {
      return {
        success: true,
        output: '该记忆与已有条目相近，未重复保存。',
      };
    }
    return { success: true, output: `已保存记忆：${entry.content}` };
  },
};
