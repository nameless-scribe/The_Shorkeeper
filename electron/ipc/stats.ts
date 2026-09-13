import { trustedIpcMain as ipcMain } from './trusted-ipc';
import { getTokenUsageSummary } from '../../src/db/token-usage';
import type { TokenUsageSummaryInfo } from '../../src/shared/types';

export function registerStatsIpc() {
  ipcMain.handle('stats:getTokenUsage', (): TokenUsageSummaryInfo => {
    return getTokenUsageSummary();
  });
}
