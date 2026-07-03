import type { Skill } from './loader';

function messageMatchesKeywords(message: string, keywords: string[] | undefined): boolean {
  if (!keywords?.length) return false;
  const lower = message.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * 从已启用技能中解析本轮应激活的技能：
 * - manual：始终激活
 * - auto：userMessage 命中 matchKeywords 时激活
 */
export function resolveActiveSkills(userMessage: string, enabled: Skill[]): Skill[] {
  const active = enabled.filter((skill) => {
    if (skill.trigger === 'manual') return true;
    return messageMatchesKeywords(userMessage, skill.matchKeywords);
  });

  return [...active].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}
