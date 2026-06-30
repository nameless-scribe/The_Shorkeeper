import type { LlmMessage } from '../agent/types';
import { shouldUseExplicitCache } from './config';

type ApiTextBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

/** 将 system 消息转为百炼显式缓存格式（content 数组 + cache_control） */
export function encodeMessagesForApi(
  messages: LlmMessage[],
  cacheStablePrefix?: string,
): Array<Record<string, unknown>> {
  if (!shouldUseExplicitCache() || !cacheStablePrefix?.trim()) {
    return messages as Array<Record<string, unknown>>;
  }

  return messages.map((msg) => {
    if (msg.role !== 'system') return msg as Record<string, unknown>;

    const stable = cacheStablePrefix.trim();
    let dynamic: string | null = null;

    if (msg.content.startsWith(stable)) {
      dynamic = msg.content.slice(stable.length).replace(/^\n+/, '').trim() || null;
    } else {
      dynamic = msg.content.trim() || null;
    }

    const blocks: ApiTextBlock[] = [
      { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    ];
    if (dynamic) {
      blocks.push({ type: 'text', text: dynamic });
    }

    return { role: 'system', content: blocks };
  });
}
