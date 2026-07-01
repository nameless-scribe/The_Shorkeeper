import type { WebSearchProvider, WebSearchProviderResult, WebSearchResultItem } from './types';

const BOCHA_ENDPOINTS = [
  'https://api.bochaai.com/v1/web-search',
  'https://api.bocha.cn/v1/web-search',
];

interface BochaWebPage {
  name?: string;
  url?: string;
  snippet?: string;
  summary?: string;
  siteName?: string;
  datePublished?: string;
}

interface BochaResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: {
    webPages?: {
      value?: BochaWebPage[];
    };
  };
}

function inferFreshness(query: string): string {
  if (/今天|今日|热搜|最新|刚刚|昨夜|昨晚/.test(query)) return 'oneDay';
  if (/本周|这周|近一周/.test(query)) return 'oneWeek';
  if (/本月|这个月|近一月/.test(query)) return 'oneMonth';
  return 'noLimit';
}

function formatBochaError(status: number, body: string): string {
  if (status === 401) return '博查 API Key 无效，请在 设置 → 插件 填写或检查 .env';
  if (status === 403) return '博查账户余额不足，请前往 open.bochaai.com 充值';
  if (status === 429) return '博查搜索请求过于频繁，请稍后再试';
  const trimmed = body.trim().slice(0, 200);
  return trimmed ? `博查搜索失败: HTTP ${status} ${trimmed}` : `博查搜索失败: HTTP ${status}`;
}

function parseBochaItems(data: BochaResponse): WebSearchResultItem[] {
  const pages = data.data?.webPages?.value ?? [];
  return pages
    .map((page) => ({
      title: page.name?.trim() || '无标题',
      url: page.url?.trim() || '',
      snippet: (page.summary || page.snippet || '').trim(),
      siteName: page.siteName?.trim(),
      datePublished: page.datePublished?.trim(),
    }))
    .filter((item) => item.url || item.snippet);
}

async function callBochaEndpoint(
  endpoint: string,
  apiKey: string,
  query: string,
  signal: AbortSignal,
): Promise<WebSearchProviderResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      freshness: inferFreshness(query),
      summary: true,
      count: 10,
    }),
    signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(formatBochaError(response.status, text));
  }

  let data: BochaResponse;
  try {
    data = JSON.parse(text) as BochaResponse;
  } catch {
    throw new Error('博查搜索返回了无效的 JSON');
  }

  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(data.msg || data.message || `博查搜索失败 (code ${data.code})`);
  }

  const items = parseBochaItems(data);
  return { items, provider: 'bocha' };
}

export function createBochaProvider(apiKey: string): WebSearchProvider {
  return {
    name: 'bocha',
    async search(query, signal) {
      let lastError: Error | null = null;
      for (const endpoint of BOCHA_ENDPOINTS) {
        try {
          return await callBochaEndpoint(endpoint, apiKey, query, signal);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (lastError.message.includes('401') || lastError.message.includes('403')) {
            throw lastError;
          }
        }
      }
      throw lastError ?? new Error('博查搜索不可用');
    },
  };
}

export function formatWebSearchOutput(
  query: string,
  result: WebSearchProviderResult,
): string {
  if (!result.items.length) {
    return `未找到「${query}」的相关结果，请尝试更具体的关键词。`;
  }

  const lines = result.items.map((item, index) => {
    const meta: string[] = [];
    if (item.siteName) meta.push(item.siteName);
    if (item.datePublished) meta.push(item.datePublished);
    const metaLine = meta.length ? ` (${meta.join(' · ')})` : '';
    return [
      `[${index + 1}] ${item.title}${metaLine}`,
      item.url,
      item.snippet || '（无摘要）',
    ].join('\n');
  });

  return `搜索来源：博查\n\n${lines.join('\n\n')}`;
}
