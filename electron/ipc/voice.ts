import { trustedIpcMain as ipcMain } from './trusted-ipc';
import {
  getVoiceSettings,
  getVoiceApiKeyMasked,
  isVoiceApiConfigured,
  resolveTtsEndpoint,
  saveVoiceSettings,
} from '../../src/config/voice';
import { synthesizeVoiceChunk } from '../../src/voice/synthesize-chunk';
import { getBailianSttEngine, createSttStreamSession } from '../../src/voice/bailian-stt';
import { getCallSessionManager, shutdownCallSessions } from '../../src/voice/call-session';
import { SttStreamRegistry } from '../../src/voice/stt-stream-registry';
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
import {
  requireBoolean,
  requireEnum,
  requireFiniteNumber,
  requireRecord,
  requireString,
} from '../../src/shared/ipc-validation';

const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024;
const MAX_VOICE_TEXT_CHARS = 100_000;

function requireCallId(value: unknown): string {
  return requireString(value, '通话 ID', { maxLength: 200 });
}

function parseCallPayload(value: unknown): Record<string, unknown> {
  return requireRecord(value, '通话参数');
}

function parseVoiceSettingsPatch(value: unknown): VoiceSettingsPatch {
  const input = requireRecord(value, '语音设置');
  const output: Record<string, unknown> = {};
  for (const key of [
    'ttsEnabled', 'ttsAutoPlay', 'sttEnabled', 'pushToTalk', 'sttAutoSend',
    'callAllowBargeIn', 'callPersistTranscript', 'useChatApi',
  ]) {
    if (input[key] !== undefined) output[key] = requireBoolean(input[key], key);
  }
  const numericRules: Record<string, [number, number]> = {
    ttsRate: [0.5, 2],
    ttsVolume: [0, 100],
    ttsPlaybackGain: [0.5, 3],
    ttsMaxChars: [1, 10_000],
    callSilenceMs: [100, 5_000],
  };
  for (const [key, [min, max]] of Object.entries(numericRules)) {
    if (input[key] !== undefined) {
      output[key] = requireFiniteNumber(input[key], key, { min, max });
    }
  }
  const stringRules: Record<string, number> = {
    ttsVoiceId: 500,
    voiceApiKey: 20_000,
    voiceTtsEndpoint: 2_048,
  };
  for (const [key, maxLength] of Object.entries(stringRules)) {
    if (input[key] !== undefined) {
      output[key] = requireString(input[key], key, { allowEmpty: true, maxLength });
    }
  }
  if (input.activeClonedProfileId !== undefined) {
    output.activeClonedProfileId = input.activeClonedProfileId === null
      ? null
      : requireString(input.activeClonedProfileId, 'activeClonedProfileId', { maxLength: 200 });
  }
  const enumRules = {
    ttsModel: ['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-plus', 'cosyvoice-v3-flash'],
    ttsVoiceSource: ['preset', 'cloned'],
    sttLanguage: ['zh', 'en', 'auto'],
    sttModel: ['paraformer-realtime-v2', 'paraformer-realtime-v1'],
    playbackTarget: ['chat', 'pet', 'both'],
    callMode: ['push_to_talk', 'vad_auto'],
  } as const;
  for (const [key, allowed] of Object.entries(enumRules)) {
    if (input[key] !== undefined) {
      output[key] = requireEnum(input[key], key, allowed);
    }
  }
  return output as VoiceSettingsPatch;
}

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

const callSttStreams = new SttStreamRegistry();

function abortCallSttStream(callId: string): void {
  callSttStreams.abort(callId);
}

export function shutdownVoiceRuntime(): void {
  callSttStreams.abortAll();
  shutdownCallSessions();
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
      const saved = saveVoiceSettings(parseVoiceSettingsPatch(patch));
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

      const input = requireRecord(payload, '语音合成参数');
      const raw = requireString(input.text, '朗读文本', {
        allowEmpty: true,
        maxLength: MAX_VOICE_TEXT_CHARS,
      }).trim();
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

      const input = requireRecord(payload, '语音合成参数');
      const raw = requireString(input.text, '朗读文本', {
        allowEmpty: true,
        maxLength: settings.ttsMaxChars,
      }).trim();
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

      const input = requireRecord(payload, '语音识别参数');
      if (!(input.audio instanceof ArrayBuffer)) {
        return { ok: false, error: '录音数据格式无效' };
      }
      const audio = input.audio;
      if (audio.byteLength === 0) {
        return { ok: false, error: '录音数据为空' };
      }

      if (audio.byteLength > MAX_TRANSCRIBE_BYTES) {
        return { ok: false, error: '录音数据过大' };
      }

      const sampleRate = requireFiniteNumber(input.sampleRate, '采样率');
      if (sampleRate !== 8_000 && sampleRate !== 16_000) {
        throw new TypeError('采样率仅支持 8000 或 16000');
      }
      const lang = input.lang === undefined
        ? settings.sttLanguage
        : requireEnum(input.lang, '识别语言', ['zh', 'en', 'auto'] as const);
      const languageHints = lang === 'auto' ? undefined : [lang];

      try {
        const result = await getBailianSttEngine().transcribe(audio, {
          model: settings.sttModel,
          sampleRate,
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

      const input = parseCallPayload(payload);
      const callId = requireCallId(input.callId);
      const record = getCallSessionManager().get(callId);
      if (!record || record.state === 'idle') {
        return { ok: false, error: '通话不存在' };
      }

      try {
        const started = await callSttStreams.start(
          callId,
          () => createSttStreamSession(buildSttOptions(settings), {
            onPartial: (text) => {
              broadcastAgentEvent(ev.callTranscript(callId, 'user', text, false));
            },
          }),
          () => {
            const current = getCallSessionManager().get(callId);
            return Boolean(current && current.state !== 'idle');
          },
        );
        if (!started) {
          return { ok: false, error: '语音识别启动已取消' };
        }
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
      const input = parseCallPayload(payload);
      const callId = requireCallId(input.callId);
      const session = callSttStreams.get(callId);
      if (!session) {
        return { ok: false, error: '流式识别未开始' };
      }
      if (!(input.chunk instanceof ArrayBuffer)) {
        return { ok: false, error: '音频块格式无效' };
      }
      if (input.chunk.byteLength === 0) {
        return { ok: true };
      }
      if (input.chunk.byteLength > 512 * 1024) {
        return { ok: false, error: '音频块过大' };
      }
      try {
        session.pushPcm(input.chunk);
        return { ok: true };
      } catch (err) {
        abortCallSttStream(callId);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'voice:stt:finishCallStream',
    async (_event, payload: VoiceSttCallStreamFinishPayload): Promise<VoiceSttCallStreamFinishResult> => {
      const input = parseCallPayload(payload);
      const session = callSttStreams.take(requireCallId(input.callId));
      if (!session) {
        return { ok: false, error: '流式识别未开始' };
      }
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
      const input = parseCallPayload(payload);
      abortCallSttStream(requireCallId(input.callId));
      return { ok: true };
    },
  );

  ipcMain.handle(
    'voice:call:start',
    (_event, payload: VoiceCallStartPayload): VoiceCallStartResult => {
      const input = parseCallPayload(payload);
      const sessionId = input.sessionId === undefined
        ? undefined
        : requireString(input.sessionId, '会话 ID', { maxLength: 200 });
      return getCallSessionManager().start(sessionId);
    },
  );

  ipcMain.handle(
    'voice:call:userText',
    async (_event, payload: VoiceCallUserTextPayload): Promise<VoiceCallSimpleResult> => {
      const input = parseCallPayload(payload);
      return getCallSessionManager().submitUserText(
        requireCallId(input.callId),
        requireString(input.text, '通话文本', { maxLength: MAX_VOICE_TEXT_CHARS }),
      );
    },
  );

  ipcMain.handle(
    'voice:call:speakingDone',
    (_event, payload: VoiceCallSpeakingDonePayload): VoiceCallSimpleResult => {
      const input = parseCallPayload(payload);
      return getCallSessionManager().speakingDone(requireCallId(input.callId));
    },
  );

  ipcMain.handle(
    'voice:call:interrupt',
    (_event, payload: VoiceCallInterruptPayload): VoiceCallSimpleResult => {
      const input = parseCallPayload(payload);
      const callId = requireCallId(input.callId);
      abortCallSttStream(callId);
      return getCallSessionManager().interrupt(callId);
    },
  );

  ipcMain.handle(
    'voice:call:end',
    (_event, payload: VoiceCallEndPayload): VoiceCallSimpleResult => {
      const input = parseCallPayload(payload);
      const callId = requireCallId(input.callId);
      abortCallSttStream(callId);
      return getCallSessionManager().end(callId);
    },
  );

  ipcMain.handle('voice:call:isActive', (_event, sessionId?: string): { active: boolean } => ({
    active: getCallSessionManager().isActive(
      sessionId === undefined ? undefined : requireString(sessionId, '会话 ID', { maxLength: 200 }),
    ),
  }));
}
