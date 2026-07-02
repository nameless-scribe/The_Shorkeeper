import { ipcMain } from 'electron';
import {
  getVoiceSettings,
  getVoiceApiKeyMasked,
  isVoiceApiConfigured,
  resolveTtsEndpoint,
  saveVoiceSettings,
} from '../../src/config/voice';
import { synthesizeVoiceChunk } from '../../src/voice/synthesize-chunk';
import { getBailianSttEngine } from '../../src/voice/bailian-stt';
import {
  hasSpeakableDialogue,
  planStreamingSpeechFromMessage,
} from '../../src/voice/text-for-speech';
import type {
  SpeechPlaybackStep,
  VoiceSettingsInfo,
  VoiceSettingsPatch,
  VoiceSynthesizeChunkPayload,
  VoiceSynthesizeChunkResult,
  VoiceSynthesizePayload,
  VoiceSynthesizeResult,
  VoiceTranscribePayload,
  VoiceTranscribeResult,
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

      if (!hasSpeakableDialogue(raw)) {
        return { ok: false, error: '清理后无可用朗读文本' };
      }

      const plan = planStreamingSpeechFromMessage(raw, settings.ttsMaxChars);
      const speakSteps = plan.filter((step) => step.type === 'speak');
      if (speakSteps.length === 0) {
        return { ok: false, error: '清理后无可用朗读文本' };
      }

      try {
        const steps: SpeechPlaybackStep[] = [];

        for (const step of plan) {
          if (step.type === 'pause') {
            steps.push({ kind: 'pause', durationMs: step.ms });
            continue;
          }

          const result = await synthesizeVoiceChunk(step.text);
          steps.push({
            kind: 'audio',
            mime: result.mime,
            audio: result.audio,
          });
        }

        return { ok: true, steps };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    'voice:synthesizeChunk',
    async (_event, payload: VoiceSynthesizeChunkPayload): Promise<VoiceSynthesizeChunkResult> => {
      const settings = getVoiceSettings();
      if (!settings.ttsEnabled) {
        return { ok: false, error: '语音朗读已关闭' };
      }

      const raw = payload.text?.trim() ?? '';
      if (!raw) {
        return { ok: false, error: '朗读文本为空' };
      }

      try {
        const result = await synthesizeVoiceChunk(raw);
        return { ok: true, audio: result.audio, mime: result.mime };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    'voice:transcribe',
    async (_event, payload: VoiceTranscribePayload): Promise<VoiceTranscribeResult> => {
      const settings = getVoiceSettings();
      if (!settings.sttEnabled) {
        return { ok: false, error: '语音输入已关闭' };
      }

      const audio = payload.audio;
      if (!audio || audio.byteLength === 0) {
        return { ok: false, error: '录音数据为空' };
      }

      const lang = payload.lang ?? settings.sttLanguage;
      const languageHints = lang === 'auto' ? undefined : [lang];

      try {
        const result = await getBailianSttEngine().transcribe(audio, {
          model: settings.sttModel,
          sampleRate: payload.sampleRate,
          languageHints,
        });
        return { ok: true, text: result.text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );
}
