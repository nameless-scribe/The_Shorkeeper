import { trustedIpcMain as ipcMain } from './trusted-ipc';
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
import { requireEnum, requireFiniteNumber, requireString } from '../../src/shared/ipc-validation';

function requireCandidateId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('记忆候选不存在');
  }
  return requireString(id, '记忆候选 ID', { maxLength: 200 }).trim();
}

function requireMemoryId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('长期记忆不存在');
  }
  return requireString(id, '长期记忆 ID', { maxLength: 200 }).trim();
}

function toMemoryInfo(entry: ReturnType<typeof listManagedMemories>[number]): MemoryInfo {
  return {
    id: entry.id,
    memoryKey: entry.memoryKey,
    content: entry.content,
    importance: entry.importance,
    sourceSessionId: entry.sourceSessionId,
    memoryType: entry.memoryType,
    confidence: entry.confidence,
    sensitivity: entry.sensitivity,
    modelUsePolicy: entry.modelUsePolicy,
    status: entry.status,
    validFrom: entry.validFrom,
    expiresAt: entry.expiresAt,
    supersededBy: entry.supersededBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function registerMemoryIpc() {
  ipcMain.handle(
    'memory:candidates:list',
    (_event, status?: MemoryCandidateStatus, limit?: number): MemoryCandidateInfo[] =>
      listMemoryCandidates(
        status === undefined
          ? normalizeMemoryCandidateStatus(undefined)
          : requireEnum(status, '记忆候选状态', ['pending', 'confirmed', 'rejected'] as const),
        limit === undefined ? 100 : Math.floor(requireFiniteNumber(limit, 'limit', { min: 1, max: 500 })),
      ),
  );

  ipcMain.handle('memory:candidates:confirm', (_event, id: unknown): Promise<MemoryCandidateInfo> =>
    confirmMemoryCandidate(requireCandidateId(id)),
  );

  ipcMain.handle('memory:candidates:reject', (_event, id: unknown): MemoryCandidateInfo =>
    rejectMemoryCandidate(requireCandidateId(id)),
  );

  ipcMain.handle('memory:list', (_event, limit?: number): MemoryInfo[] =>
    listManagedMemories(
      limit === undefined ? 200 : Math.floor(requireFiniteNumber(limit, 'limit', { min: 1, max: 500 })),
    ).map(toMemoryInfo),
  );

  ipcMain.handle('memory:update', async (_event, id: unknown, content: unknown): Promise<MemoryInfo> => {
    const text = requireString(content, '记忆内容', { maxLength: 100_000 });
    return toMemoryInfo(await updateManagedMemory(requireMemoryId(id), text));
  });

  ipcMain.handle('memory:delete', (_event, id: unknown): MemoryInfo =>
    toMemoryInfo(deleteManagedMemory(requireMemoryId(id))),
  );
}
