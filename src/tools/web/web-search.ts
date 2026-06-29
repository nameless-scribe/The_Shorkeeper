import type { ToolDefinition } from '../types';

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: Array<
    | { Text?: string; FirstURL?: string }
    | { Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }
  >;
}

function formatRelatedTopics(
  topics: DuckDuckGoResponse['RelatedTopics'],
): string[] {
  if (!topics?.length) return [];
  const lines: string[] = [];
  for (const topic of topics) {
    if ('Topics' in topic && topic.Topics) {
      for (const sub of topic.Topics) {
        if (sub.Text) lines.push(`- ${sub.Text}`);
      }
    } else if ('Text' in topic && topic.Text) {
      lines.push(`- ${topic.Text}`);
    }
  }
  return lines.slice(0, 8);
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: '在网络上搜索信息，返回摘要与相关条目',
  category: 'web',
  requiresPermission: ['network'],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
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

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
      const response = await fetch(url, { signal: ctx.signal });
      if (!response.ok) {
        return {
          success: false,
          output: '',
          error: `搜索请求失败: HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as DuckDuckGoResponse;
      const parts: string[] = [];

      if (data.Heading) parts.push(`标题: ${data.Heading}`);
      if (data.AbstractText) {
        parts.push(`摘要: ${data.AbstractText}`);
        if (data.AbstractURL) parts.push(`来源: ${data.AbstractURL}`);
      }

      const related = formatRelatedTopics(data.RelatedTopics);
      if (related.length) {
        parts.push('相关结果:');
        parts.push(...related);
      }

      if (!parts.length) {
        return {
          success: true,
          output: `未找到「${query}」的即时摘要，请尝试更具体的关键词。`,
        };
      }

      return { success: true, output: parts.join('\n') };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
