import { ipcMain } from 'electron';
import {
  getEnabledSkillIds,
  listSkillsWithState,
  toggleSkill,
} from '../../src/skills/state';
import { invalidateAgentRegistry } from '../../src/tools/agent-registry';

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:list', () => listSkillsWithState());

  ipcMain.handle('skills:getEnabled', () => getEnabledSkillIds());

  ipcMain.handle('skills:toggle', (_event, id: string, enabled: boolean) => {
    toggleSkill(id, enabled);
    invalidateAgentRegistry();
    return listSkillsWithState();
  });
}
