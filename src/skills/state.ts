import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import { discoverSkills, type Skill } from './loader';
import { resolveActiveSkills, resolveActiveSkillsWithDiagnostics } from './resolve';

const ENABLED_KEY = 'skills.enabled';

export interface SkillInfo extends Skill {
  enabled: boolean;
}

export function getEnabledSkillIds(): string[] {
  const raw = getJsonSetting<unknown>(ENABLED_KEY);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
}

export function setEnabledSkillIds(ids: string[]): void {
  setJsonSetting(
    ENABLED_KEY,
    [...new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0))],
  );
}

export function getEnabledSkills(): Skill[] {
  const ids = new Set(getEnabledSkillIds());
  const seen = new Set<string>();
  return discoverSkills().filter((skill) => {
    if (
      !ids.has(skill.id) ||
      seen.has(skill.id) ||
      skill.kind === 'internal' ||
      skill.validationErrors.length > 0
    ) return false;
    seen.add(skill.id);
    return true;
  });
}

export function getActiveSkills(userMessage: string): Skill[] {
  return resolveActiveSkills(userMessage, getEnabledSkills());
}

export function getActiveSkillResolution(userMessage: string) {
  return resolveActiveSkillsWithDiagnostics(userMessage, getEnabledSkills());
}

export function listSkillsWithState(): SkillInfo[] {
  const enabled = new Set(getEnabledSkillIds());
  return discoverSkills().filter((skill) => skill.kind !== 'internal').map((skill) => ({
    ...skill,
    enabled: enabled.has(skill.id),
  }));
}

export function toggleSkill(id: string, enabled: boolean): void {
  const skill = discoverSkills().find((item) => item.id === id);
  if (!skill || skill.kind === 'internal' || skill.validationErrors.length > 0) return;

  const ids = new Set(getEnabledSkillIds());
  if (enabled) ids.add(id);
  else ids.delete(id);
  setEnabledSkillIds([...ids]);
}
