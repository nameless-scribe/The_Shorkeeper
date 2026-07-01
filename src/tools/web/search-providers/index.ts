import { getWebSearchApiKey } from '../../../config/web-search-config';
import { createBochaProvider } from './bocha';
import type { WebSearchProvider } from './types';

export function resolveWebSearchProvider(): WebSearchProvider | null {
  const apiKey = getWebSearchApiKey();
  if (!apiKey) return null;
  return createBochaProvider(apiKey);
}

export function webSearchNotConfiguredMessage(): string {
  return (
    '未配置联网搜索 API Key。请在 设置 → 插件 → 联网搜索 填写博查 Key，' +
    '或在 .env 设置 WEB_SEARCH_API_KEY（也可使用 BOCHA_API_KEY）。' +
    '注册：https://open.bochaai.com'
  );
}
