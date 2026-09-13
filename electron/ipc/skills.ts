import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getEnabledSkillIds,
  listSkillsWithState,
  toggleSkill,
} from '../../src/skills/state';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';
import { invalidateStableContext } from '../../src/agent/stable-context';
import { requireBoolean, requireString } from '../../src/shared/ipc-validation';

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:list', () => listSkillsWithState());

  ipcMain.handle('skills:getEnabled', () => getEnabledSkillIds());

  ipcMain.handle('skills:toggle', (_event, id: string, enabled: boolean) => {
    toggleSkill(
      requireString(id, 'Skill ID', { maxLength: 200 }),
      requireBoolean(enabled, 'enabled'),
    );
    invalidateAgentRegistry();
    invalidateStableContext();
    return listSkillsWithState();
  });
}
