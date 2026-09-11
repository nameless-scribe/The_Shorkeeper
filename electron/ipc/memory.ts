import { ipcMain } from 'electron';
import {
  confirmMemoryCandidate,
  listMemoryCandidates,
  normalizeMemoryCandidateStatus,
  rejectMemoryCandidate,
} from '../../src/memory/candidates';
import type { MemoryCandidateInfo, MemoryCandidateStatus } from '../../src/shared/types';

function requireCandidateId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('记忆候选不存在');
  }
  return id.trim();
}

export function registerMemoryIpc() {
  ipcMain.handle(
    'memory:candidates:list',
    (_event, status?: MemoryCandidateStatus, limit?: number): MemoryCandidateInfo[] =>
      listMemoryCandidates(normalizeMemoryCandidateStatus(status), limit ?? 100),
  );

  ipcMain.handle('memory:candidates:confirm', (_event, id: unknown): Promise<MemoryCandidateInfo> =>
    confirmMemoryCandidate(requireCandidateId(id)),
  );

  ipcMain.handle('memory:candidates:reject', (_event, id: unknown): MemoryCandidateInfo =>
    rejectMemoryCandidate(requireCandidateId(id)),
  );
}
