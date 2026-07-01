import { describe, expect, it, vi, beforeEach } from 'vitest';

const store: Record<string, string> = {};

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn((key: string) => store[key] ?? null),
  setSetting: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
}));

vi.mock('../../agent/stable-context', () => ({
  invalidateStableContext: vi.fn(),
}));

import { invalidateStableContext } from '../../agent/stable-context';
import {
  getPersonaSettings,
  resetPersona,
  setPersona,
  MAX_PERSONA_PROMPT_LENGTH,
} from '../persona';
import {
  PERSONA_CUSTOM_VERSION,
  PERSONA_SETTING_KEYS,
  SHOREKEEPER_PERSONA,
} from '../../db/seeds/persona-shorekeeper';

describe('persona config', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    store[PERSONA_SETTING_KEYS.systemPrompt] = SHOREKEEPER_PERSONA.systemPrompt;
    store[PERSONA_SETTING_KEYS.version] = SHOREKEEPER_PERSONA.version;
    store[PERSONA_SETTING_KEYS.displayName] = '守岸人';
    vi.mocked(invalidateStableContext).mockReset();
  });

  it('returns persona settings', () => {
    const info = getPersonaSettings();
    expect(info.isCustom).toBe(false);
    expect(info.displayName).toBe('守岸人');
    expect(info.systemPrompt).toBe(SHOREKEEPER_PERSONA.systemPrompt);
  });

  it('setPersona marks custom and invalidates cache', () => {
    const info = setPersona({ systemPrompt: '新人设', displayName: '测试角色' });
    expect(info.isCustom).toBe(true);
    expect(info.version).toBe(PERSONA_CUSTOM_VERSION);
    expect(store[PERSONA_SETTING_KEYS.version]).toBe(PERSONA_CUSTOM_VERSION);
    expect(invalidateStableContext).toHaveBeenCalled();
  });

  it('rejects empty prompt', () => {
    expect(() => setPersona({ systemPrompt: '   ' })).toThrow('不能为空');
  });

  it('rejects oversized prompt', () => {
    expect(() => setPersona({ systemPrompt: 'x'.repeat(MAX_PERSONA_PROMPT_LENGTH + 1) })).toThrow(
      '不能超过',
    );
  });

  it('resetPersona restores builtin', () => {
    store[PERSONA_SETTING_KEYS.version] = PERSONA_CUSTOM_VERSION;
    const info = resetPersona();
    expect(info.isCustom).toBe(false);
    expect(info.version).toBe(SHOREKEEPER_PERSONA.version);
    expect(store[PERSONA_SETTING_KEYS.systemPrompt]).toBe(SHOREKEEPER_PERSONA.systemPrompt);
    expect(invalidateStableContext).toHaveBeenCalled();
  });
});
