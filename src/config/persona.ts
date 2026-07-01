import { invalidateStableContext } from '../agent/stable-context';
import { getSetting, setSetting } from '../db/app-settings';
import {
  DEFAULT_PERSONA_DISPLAY_NAME,
  PERSONA_CUSTOM_VERSION,
  PERSONA_SETTING_KEYS,
  SHOREKEEPER_PERSONA,
} from '../db/seeds/persona-shorekeeper';
import type { PersonaSettingsInfo, PersonaSettingsPatch } from '../shared/types';
import { MAX_PERSONA_PROMPT_LENGTH } from '../shared/persona';

export { MAX_PERSONA_PROMPT_LENGTH };

function getPersonaUpdatedAt(): number | null {
  const raw = getSetting('persona.updated_at');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function getPersonaSettings(): PersonaSettingsInfo {
  const systemPrompt =
    getSetting(PERSONA_SETTING_KEYS.systemPrompt)?.trim() ?? SHOREKEEPER_PERSONA.systemPrompt;
  const version = getSetting(PERSONA_SETTING_KEYS.version) ?? SHOREKEEPER_PERSONA.version;
  const displayName =
    getSetting(PERSONA_SETTING_KEYS.displayName)?.trim() || DEFAULT_PERSONA_DISPLAY_NAME;

  return {
    systemPrompt,
    version,
    displayName,
    isCustom: version === PERSONA_CUSTOM_VERSION,
    builtinVersion: SHOREKEEPER_PERSONA.version,
    charCount: systemPrompt.length,
    updatedAt: getPersonaUpdatedAt(),
  };
}

export function setPersona(patch: PersonaSettingsPatch): PersonaSettingsInfo {
  const current = getPersonaSettings();
  const systemPrompt = (patch.systemPrompt ?? current.systemPrompt).trim();
  const displayName = (patch.displayName ?? current.displayName).trim() || DEFAULT_PERSONA_DISPLAY_NAME;

  if (!systemPrompt) {
    throw new Error('人设内容不能为空');
  }

  if (systemPrompt.length > MAX_PERSONA_PROMPT_LENGTH) {
    throw new Error(`人设内容不能超过 ${MAX_PERSONA_PROMPT_LENGTH} 字`);
  }

  const now = Date.now();
  setSetting(PERSONA_SETTING_KEYS.systemPrompt, systemPrompt);
  setSetting(PERSONA_SETTING_KEYS.version, PERSONA_CUSTOM_VERSION);
  setSetting(PERSONA_SETTING_KEYS.displayName, displayName);
  setSetting('persona.updated_at', String(now));

  invalidateStableContext();
  return getPersonaSettings();
}

export function resetPersona(): PersonaSettingsInfo {
  const now = Date.now();
  setSetting(PERSONA_SETTING_KEYS.systemPrompt, SHOREKEEPER_PERSONA.systemPrompt);
  setSetting(PERSONA_SETTING_KEYS.version, SHOREKEEPER_PERSONA.version);
  setSetting(PERSONA_SETTING_KEYS.displayName, DEFAULT_PERSONA_DISPLAY_NAME);
  setSetting('persona.updated_at', String(now));

  invalidateStableContext();
  return getPersonaSettings();
}
