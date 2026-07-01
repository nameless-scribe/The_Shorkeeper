import { ipcMain } from 'electron';
import {
  getVoiceSettings,
  getVoiceApiKeyMasked,
  isVoiceApiConfigured,
  resolveTtsEndpoint,
  saveVoiceSettings,
} from '../../src/config/voice';
import { getBailianTtsEngine } from '../../src/voice/bailian-tts';
import { stripMarkdownForSpeech, truncateForSpeech } from '../../src/voice/text-for-speech';
import type {
  VoiceSettingsInfo,
  VoiceSettingsPatch,
  VoiceSynthesizePayload,
  VoiceSynthesizeResult,
} from '../../src/shared/types';

function toInfo(settings: ReturnType<typeof getVoiceSettings>): VoiceSettingsInfo {
  const { voiceApiKey: _hidden, ...rest } = settings;
  return {
    ...rest,
    apiKeyConfigured: isVoiceApiConfigured(),
    voiceApiKeyMasked: getVoiceApiKeyMasked(),
    voiceConfigured: Boolean(settings.ttsVoiceId.trim()),
    ttsEndpoint: resolveTtsEndpoint(),
  };
}

export function registerVoiceIpc(): void {
  ipcMain.handle('voice:getSettings', (): VoiceSettingsInfo => toInfo(getVoiceSettings()));

  ipcMain.handle(
    'voice:saveSettings',
    (_event, patch: VoiceSettingsPatch): VoiceSettingsInfo => {
      const saved = saveVoiceSettings(patch);
      return toInfo(saved);
    },
  );

  ipcMain.handle(
    'voice:synthesize',
    async (_event, payload: VoiceSynthesizePayload): Promise<VoiceSynthesizeResult> => {
      const settings = getVoiceSettings();
      if (!settings.ttsEnabled) {
        return { ok: false, error: '语音朗读已关闭' };
      }

      const raw = payload.text?.trim() ?? '';
      if (!raw) {
        return { ok: false, error: '朗读文本为空' };
      }

      const cleaned = truncateForSpeech(
        stripMarkdownForSpeech(raw),
        settings.ttsMaxChars,
      );
      if (!cleaned) {
        return { ok: false, error: '清理后无可用朗读文本' };
      }

      try {
        const engine = getBailianTtsEngine();
        const result = await engine.synthesize(cleaned, {
          model: settings.ttsModel,
          voiceId: settings.ttsVoiceId,
          rate: settings.ttsRate,
          format: 'mp3',
          languageHint: settings.sttLanguage === 'en' ? 'en' : 'zh',
        });
        const audioBuffer = Buffer.from(result.audio);
        return {
          ok: true,
          audio: audioBuffer.buffer.slice(
            audioBuffer.byteOffset,
            audioBuffer.byteOffset + audioBuffer.byteLength,
          ),
          mime: result.mime,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );
}
