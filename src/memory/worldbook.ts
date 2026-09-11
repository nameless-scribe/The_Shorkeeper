import {
  createWorldbookEntry,
  deleteWorldbookEntry,
  getWorldbookEntry,
  hasWorldbookFts,
  listWorldbookEntries,
  searchWorldbookEntries,
  searchWorldbookFtsIds,
  updateWorldbookEntry,
  type WorldbookEntry,
} from '../db/repositories/worldbook';

export {
  createWorldbookEntry,
  deleteWorldbookEntry,
  getWorldbookEntry,
  listWorldbookEntries,
  updateWorldbookEntry,
  type WorldbookEntry,
};

function parseKeys(keys: string): string[] {
  return keys
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function matchWorldbookFts(userMessage: string, limit: number): WorldbookEntry[] {
  const tokens = userMessage
    .split(/[\s,，。！？、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const hitIds = searchWorldbookFtsIds(tokens);
  if (!hitIds?.length) {
    return matchWorldbookKeywords(userMessage, limit);
  }

  const entries = listWorldbookEntries(false).filter((e) => hitIds.includes(e.id));
  return entries.slice(0, limit);
}

function matchWorldbookKeywords(userMessage: string, limit: number): WorldbookEntry[] {
  const message = userMessage.toLowerCase();
  const entries = listWorldbookEntries(false);

  const hits = entries.filter((entry) =>
    parseKeys(entry.keys).some((key) => message.includes(key.toLowerCase())),
  );

  return hits.slice(0, limit);
}

/** 根据用户消息匹配 Worldbook 条目（FTS5 可用时优先，否则关键词匹配） */
export function matchWorldbook(userMessage: string, limit = 5): WorldbookEntry[] {
  if (!userMessage.trim()) return [];
  if (hasWorldbookFts()) {
    return matchWorldbookFts(userMessage, limit);
  }
  return matchWorldbookKeywords(userMessage, limit);
}

export function searchWorldbook(query: string, limit = 5): WorldbookEntry[] {
  return searchWorldbookEntries(query, limit);
}

export function formatWorldbookForPrompt(entries: WorldbookEntry[]): string | null {
  if (!entries.length) return null;
  const blocks = entries.map((entry) => `（关键词：${entry.keys}）\n${entry.content}`);
  return `【世界观 / 背景】\n${blocks.join('\n\n')}`;
}
