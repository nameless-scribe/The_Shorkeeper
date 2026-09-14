/**
 * P4 录音转写记录的只读 IPC。
 *
 * 只读：转写由 `transcribe_audio` 工具发起，走工具权限确认那条路；
 * 界面不该有第二条能触发转写（并计费）的入口。
 */
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import type { AudioTranscriptInfo } from '../../src/shared/types';
import { requireFiniteNumber } from '../../src/shared/ipc-validation';
import { listAudioTranscripts } from '../../src/db/repositories/audio-transcripts';

const MAX_LIMIT = 200;

export function registerTranscriptsIpc(): void {
  ipcMain.handle('transcripts:list', (_event, rawLimit: unknown): AudioTranscriptInfo[] => {
    const limit =
      rawLimit === undefined
        ? 50
        : Math.max(1, Math.min(MAX_LIMIT, Math.floor(requireFiniteNumber(rawLimit, '数量上限'))));
    return listAudioTranscripts({ limit });
  });
}
