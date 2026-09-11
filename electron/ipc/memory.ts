import { ipcMain } from 'electron';
import {
  confirmMemoryCandidate,
  listMemoryCandidates,
  normalizeMemoryCandidateStatus,
  rejectMemoryCandidate,
} from '../../src/memory/candidates';
import {
  deleteManagedMemory,
  listManagedMemories,
  updateManagedMemory,
} from '../../src/memory/long-term';
import type { MemoryCandidateInfo, MemoryCandidateStatus, MemoryInfo } from '../../src/shared/types';

function requireCandidateId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('记忆候选不存在');
  }
  return id.trim();
}

function requireMemoryId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('长期记忆不存在');
  }
  return id.trim();
}

function toMemoryInfo(entry: ReturnType<typeof listManagedMemories>[number]): MemoryInfo {
  return {
    id: entry.id,
    memoryKey: entry.memoryKey,
    content: entry.content,
    importance: entry.importance,
    sourceSessionId: entry.sourceSessionId,
    createdAt: entry.createdAt,
  };
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

  ipcMain.handle('memory:list', (_event, limit?: number): MemoryInfo[] =>
    listManagedMemories(typeof limit === 'number' ? limit : 200).map(toMemoryInfo),
  );

  ipcMain.handle('memory:update', async (_event, id: unknown, content: unknown): Promise<MemoryInfo> => {
    if (typeof content !== 'string') throw new Error('记忆内容不能为空');
    return toMemoryInfo(await updateManagedMemory(requireMemoryId(id), content));
  });

  ipcMain.handle('memory:delete', (_event, id: unknown): MemoryInfo =>
    toMemoryInfo(deleteManagedMemory(requireMemoryId(id))),
  );
}
