import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import { discoverSkills, type Skill } from './loader';

const ENABLED_KEY = 'skills.enabled';

export interface SkillInfo extends Skill {
  enabled: boolean;
}

export function getEnabledSkillIds(): string[] {
  return getJsonSetting<string[]>(ENABLED_KEY) ?? [];
}

export function setEnabledSkillIds(ids: string[]): void {
  setJsonSetting(ENABLED_KEY, ids);
}

export function getEnabledSkills(): Skill[] {
  const ids = new Set(getEnabledSkillIds());
  return discoverSkills().filter((s) => ids.has(s.id));
}

export function listSkillsWithState(): SkillInfo[] {
  const enabled = new Set(getEnabledSkillIds());
  return discoverSkills().map((skill) => ({
    ...skill,
    enabled: enabled.has(skill.id),
  }));
}

export function toggleSkill(id: string, enabled: boolean): void {
  const ids = new Set(getEnabledSkillIds());
  if (enabled) ids.add(id);
  else ids.delete(id);
  setEnabledSkillIds([...ids]);
}

export function formatSkillsForPrompt(skills: Skill[]): string | null {
  if (!skills.length) return null;
  return skills.map((s) => s.systemPromptFragment).join('\n\n');
}
