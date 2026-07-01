import type { ToolDefinition } from '../types';
import { formatWebSearchOutput } from './search-providers/bocha';
import { resolveWebSearchProvider, webSearchNotConfiguredMessage } from './search-providers';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    '在网络上搜索实时信息（新闻、热搜、百科等），返回标题、链接与摘要。查询天气请优先使用 get_weather。',
  category: 'web',
  requiresPermission: ['network'],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，如「今日热搜」「某某新闻」',
      },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const { query } = args as { query?: string };
    if (!query?.trim()) {
      return { success: false, output: '', error: '缺少 query 参数' };
    }

    if (ctx.signal.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    const provider = resolveWebSearchProvider();
    if (!provider) {
      return { success: false, output: '', error: webSearchNotConfiguredMessage() };
    }

    try {
      const result = await provider.search(query.trim(), ctx.signal);
      return {
        success: true,
        output: formatWebSearchOutput(query.trim(), result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
