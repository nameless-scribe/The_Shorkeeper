import { ipcMain } from 'electron';
import {
  getVoiceSettings,
  getVoiceApiKeyMasked,
  isVoiceApiConfigured,
  resolveTtsEndpoint,
  saveVoiceSettings,
} from '../../src/config/voice';
import { synthesizeVoiceChunk } from '../../src/voice/synthesize-chunk';
import { getBailianSttEngine, createSttStreamSession, type SttStreamSession } from '../../src/voice/bailian-stt';
import { getCallSessionManager } from '../../src/voice/call-session';
import { ev } from '../../src/agent/events';
import {
  hasSpeakableDialogue,
  planStreamingSpeechFromMessage,
} from '../../src/voice/text-for-speech';
import {
  broadcastAgentEvent,
  onRunError,
  onRunFinished,
  onRunStarted,
} from '../state/presence';
import type {
  SpeechPlaybackStep,
  VoiceCallEndPayload,
  VoiceCallInterruptPayload,
  VoiceCallSimpleResult,
  VoiceCallSpeakingDonePayload,
  VoiceCallStartPayload,
  VoiceCallStartResult,
  VoiceCallUserTextPayload,
  VoiceSettingsInfo,
  VoiceSettingsPatch,
  VoiceSynthesizeChunkPayload,
  VoiceSynthesizeChunkResult,
  VoiceSynthesizePayload,
  VoiceSynthesizeResult,
  VoiceTranscribePayload,
  VoiceTranscribeResult,
  VoiceSttCallStreamStartPayload,
  VoiceSttCallStreamStartResult,
  VoiceSttCallStreamPushPayload,
  VoiceSttCallStreamFinishPayload,
  VoiceSttCallStreamFinishResult,
  VoiceSttCallStreamAbortPayload,
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

const callSttStreams = new Map<string, SttStreamSession>();

function abortCallSttStream(callId: string): void {
  const session = callSttStreams.get(callId);
  if (session) {
    session.abort();
    callSttStreams.delete(callId);
  }
}

function buildSttOptions(settings: ReturnType<typeof getVoiceSettings>, sampleRate = 16000) {
  const lang = settings.sttLanguage;
  const languageHints = lang === 'auto' ? undefined : [lang];
  return {
    model: settings.sttModel,
    sampleRate,
    languageHints,
  };
}

export function registerVoiceIpc(): void {
  getCallSessionManager({
    broadcast: broadcastAgentEvent,
    onRunStarted,
    onRunFinished,
    onRunError,
  });

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

  ipcMain.handle(
    'voice:stt:startCallStream',
    async (_event, payload: VoiceSttCallStreamStartPayload): Promise<VoiceSttCallStreamStartResult> => {
      const settings = getVoiceSettings();
      if (!settings.sttEnabled) {
        return { ok: false, error: '语音输入已关闭' };
      }

      const record = getCallSessionManager().get(payload.callId);
      if (!record || record.state === 'idle') {
        return { ok: false, error: '通话不存在' };
      }

      abortCallSttStream(payload.callId);

      try {
        const session = await createSttStreamSession(buildSttOptions(settings), {
          onPartial: (text) => {
            broadcastAgentEvent(ev.callTranscript(payload.callId, 'user', text, false));
          },
        });
        callSttStreams.set(payload.callId, session);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    'voice:stt:pushChunk',
    (_event, payload: VoiceSttCallStreamPushPayload): VoiceSttCallStreamStartResult => {
      const session = callSttStreams.get(payload.callId);
      if (!session) {
        return { ok: false, error: '流式识别未开始' };
      }
      if (!payload.chunk || payload.chunk.byteLength === 0) {
        return { ok: true };
      }
      if (payload.chunk.byteLength > 512 * 1024) {
        return { ok: false, error: '音频块过大' };
      }
      session.pushPcm(payload.chunk);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'voice:stt:finishCallStream',
    async (_event, payload: VoiceSttCallStreamFinishPayload): Promise<VoiceSttCallStreamFinishResult> => {
      const session = callSttStreams.get(payload.callId);
      if (!session) {
        return { ok: false, error: '流式识别未开始' };
      }
      callSttStreams.delete(payload.callId);
      try {
        const result = await session.finish();
        return { ok: true, text: result.text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    'voice:stt:abortCallStream',
    (_event, payload: VoiceSttCallStreamAbortPayload): VoiceSttCallStreamStartResult => {
      abortCallSttStream(payload.callId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'voice:call:start',
    (_event, payload: VoiceCallStartPayload): VoiceCallStartResult =>
      getCallSessionManager().start(payload.sessionId),
  );

  ipcMain.handle(
    'voice:call:userText',
    async (_event, payload: VoiceCallUserTextPayload): Promise<VoiceCallSimpleResult> =>
      getCallSessionManager().submitUserText(payload.callId, payload.text),
  );

  ipcMain.handle(
    'voice:call:speakingDone',
    (_event, payload: VoiceCallSpeakingDonePayload): VoiceCallSimpleResult =>
      getCallSessionManager().speakingDone(payload.callId),
  );

  ipcMain.handle(
    'voice:call:interrupt',
    (_event, payload: VoiceCallInterruptPayload): VoiceCallSimpleResult => {
      abortCallSttStream(payload.callId);
      return getCallSessionManager().interrupt(payload.callId);
    },
  );

  ipcMain.handle(
    'voice:call:end',
    (_event, payload: VoiceCallEndPayload): VoiceCallSimpleResult => {
      abortCallSttStream(payload.callId);
      return getCallSessionManager().end(payload.callId);
    },
  );

  ipcMain.handle('voice:call:isActive', (_event, sessionId?: string): { active: boolean } => ({
    active: getCallSessionManager().isActive(sessionId),
  }));
}
