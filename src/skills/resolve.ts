import type { Skill } from './loader';

export type SkillRoutingStatus = 'active' | 'not_matched' | 'conflict' | 'invalid' | 'internal';

export interface SkillRoutingDecision {
  skillId: string;
  skillName: string;
  trigger: Skill['trigger'];
  status: SkillRoutingStatus;
  matchedKeyword?: string;
  reason: string;
}

export interface ActiveSkillResolution {
  activeSkills: Skill[];
  decisions: SkillRoutingDecision[];
}

function matchedKeyword(message: string, keywords: string[] | undefined): string | undefined {
  if (!keywords?.length) return undefined;
  const lower = message.toLowerCase();
  return keywords.find((keyword) => lower.includes(keyword.toLowerCase()));
}

/**
 * Attachment previews are evidence for the task, not user intent. Keep the
 * attachment manifest/filename for format routing, but exclude parsed cell
 * contents so a spreadsheet value cannot activate an unrelated workflow.
 */
export function getSkillRoutingText(message: string): string {
  const marker = message.search(/\n\n\[工作区附件(?:已解析|解析失败)\]/);
  return marker >= 0 ? message.slice(0, marker) : message;
}

/**
 * 从已启用技能中解析本轮应激活的技能：
 * - manual：始终激活
 * - auto：userMessage 命中 matchKeywords 时激活
 */
export function resolveActiveSkillsWithDiagnostics(
  userMessage: string,
  enabled: Skill[],
): ActiveSkillResolution {
  const routingText = getSkillRoutingText(userMessage);
  const decisions: SkillRoutingDecision[] = [];
  const candidates: Skill[] = [];

  for (const skill of enabled) {
    const base = { skillId: skill.id, skillName: skill.name, trigger: skill.trigger };
    if (skill.validationErrors.length > 0) {
      decisions.push({ ...base, status: 'invalid', reason: skill.validationErrors.join('；') });
      continue;
    }
    if (skill.kind === 'internal') {
      decisions.push({ ...base, status: 'internal', reason: '内部 Skill 不进入运行上下文' });
      continue;
    }
    if (skill.trigger === 'manual') {
      candidates.push(skill);
      continue;
    }
    const keyword = matchedKeyword(
      routingText,
      skill.matchKeywords?.filter((item) => item.trim()),
    );
    if (!keyword) {
      decisions.push({ ...base, status: 'not_matched', reason: '未命中按需触发词' });
      continue;
    }
    candidates.push(skill);
    decisions.push({
      ...base,
      status: 'active',
      matchedKeyword: keyword,
      reason: `命中触发词「${keyword}」`,
    });
  }

  const unique = new Map<string, Skill>();
  for (const skill of candidates) {
    // Skill ids are the lifecycle identity. Avoid injecting the same skill
    // twice when duplicate metadata or a stale enabled list is encountered.
    if (!unique.has(skill.id)) unique.set(skill.id, skill);
  }

  const sorted = [...unique.values()].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  const selected: Skill[] = [];
  for (const candidate of sorted) {
    const conflictingSkill = selected.find((existing) =>
      existing.conflictsWith?.includes(candidate.id) || candidate.conflictsWith?.includes(existing.id));
    if (conflictingSkill) {
      const existingDecision = decisions.find(
        (decision) => decision.skillId === candidate.id && decision.status === 'active',
      );
      const conflictDecision: SkillRoutingDecision = {
        skillId: candidate.id,
        skillName: candidate.name,
        trigger: candidate.trigger,
        status: 'conflict',
        reason: `与「${conflictingSkill.name}」冲突，按优先级未激活`,
      };
      if (existingDecision) Object.assign(existingDecision, conflictDecision);
      else decisions.push(conflictDecision);
      continue;
    }
    selected.push(candidate);
    if (!decisions.some((decision) => decision.skillId === candidate.id && decision.status === 'active')) {
      decisions.push({
        skillId: candidate.id,
        skillName: candidate.name,
        trigger: candidate.trigger,
        status: 'active',
        reason: '常驻 Skill 已启用',
      });
    }
  }
  return { activeSkills: selected, decisions };
}

export function resolveActiveSkills(userMessage: string, enabled: Skill[]): Skill[] {
  return resolveActiveSkillsWithDiagnostics(userMessage, enabled).activeSkills;
}
