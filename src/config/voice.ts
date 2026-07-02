import { getJsonSetting, setJsonSetting } from '../db/app-settings';
import { getModelConfigSafe, maskApiKey } from '../models/config';
import {
  VOICE_DEFAULTS,
  type ClonedVoiceProfile,
  type VoiceSettings,
} from '../voice/types';

export type { VoiceSettings, ClonedVoiceProfile };

const SETTINGS_KEY = 'voice.settings';
const PROFILES_KEY = 'voice.profiles';

function mergeVoiceSettings(raw: Partial<VoiceSettings> | null | undefined): VoiceSettings {
  if (!raw) return { ...VOICE_DEFAULTS };
  return {
    ttsEnabled: raw.ttsEnabled ?? VOICE_DEFAULTS.ttsEnabled,
    ttsAutoPlay: raw.ttsAutoPlay ?? VOICE_DEFAULTS.ttsAutoPlay,
    ttsModel: raw.ttsModel ?? VOICE_DEFAULTS.ttsModel,
    ttsVoiceId: raw.ttsVoiceId?.trim() ?? VOICE_DEFAULTS.ttsVoiceId,
    ttsVoiceSource: raw.ttsVoiceSource ?? VOICE_DEFAULTS.ttsVoiceSource,
    activeClonedProfileId: raw.activeClonedProfileId ?? VOICE_DEFAULTS.activeClonedProfileId,
    ttsRate: clampRate(raw.ttsRate ?? VOICE_DEFAULTS.ttsRate),
    ttsVolume: clampVolume(raw.ttsVolume ?? VOICE_DEFAULTS.ttsVolume),
    ttsPlaybackGain: clampPlaybackGain(raw.ttsPlaybackGain ?? VOICE_DEFAULTS.ttsPlaybackGain),
    ttsMaxChars: raw.ttsMaxChars ?? VOICE_DEFAULTS.ttsMaxChars,
    sttEnabled: raw.sttEnabled ?? VOICE_DEFAULTS.sttEnabled,
    sttLanguage: raw.sttLanguage ?? VOICE_DEFAULTS.sttLanguage,
    pushToTalk: raw.pushToTalk ?? VOICE_DEFAULTS.pushToTalk,
    sttAutoSend: raw.sttAutoSend ?? VOICE_DEFAULTS.sttAutoSend,
    playbackTarget: raw.playbackTarget ?? VOICE_DEFAULTS.playbackTarget,
    useChatApi: raw.useChatApi ?? VOICE_DEFAULTS.useChatApi,
    voiceApiKey: raw.voiceApiKey?.trim() ?? VOICE_DEFAULTS.voiceApiKey,
    voiceTtsEndpoint: normalizeVoiceTtsEndpoint(
      raw.voiceTtsEndpoint?.trim() ?? VOICE_DEFAULTS.voiceTtsEndpoint,
    ),
  };
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return VOICE_DEFAULTS.ttsRate;
  return Math.min(2, Math.max(0.5, rate));
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return VOICE_DEFAULTS.ttsVolume;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

function clampPlaybackGain(gain: number): number {
  if (!Number.isFinite(gain)) return VOICE_DEFAULTS.ttsPlaybackGain;
  return Math.min(3, Math.max(0.5, Math.round(gain * 10) / 10));
}

export function getVoiceSettings(): VoiceSettings {
  return mergeVoiceSettings(getJsonSetting<Partial<VoiceSettings>>(SETTINGS_KEY));
}

export function saveVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const current = getVoiceSettings();
  const merged = { ...current, ...patch };
  if (patch.voiceApiKey === '') {
    merged.voiceApiKey = current.voiceApiKey;
  }
  const next = mergeVoiceSettings(merged);
  setJsonSetting(SETTINGS_KEY, next);
  return next;
}

export function listClonedProfiles(): ClonedVoiceProfile[] {
  const raw = getJsonSetting<ClonedVoiceProfile[]>(PROFILES_KEY);
  return Array.isArray(raw) ? raw : [];
}

export function saveClonedProfiles(profiles: ClonedVoiceProfile[]): ClonedVoiceProfile[] {
  setJsonSetting(PROFILES_KEY, profiles);
  return profiles;
}

function envVoiceKey(): string {
  return process.env.VOICE_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || '';
}

function envVoiceEndpoint(): string {
  return process.env.VOICE_TTS_ENDPOINT?.trim().replace(/\/$/, '') || '';
}

export function resolveVoiceApiKey(): string | null {
  const settings = getVoiceSettings();

  if (!settings.useChatApi) {
    if (settings.voiceApiKey) return settings.voiceApiKey;
    const fromEnv = envVoiceKey();
    if (fromEnv) return fromEnv;
    return null;
  }

  const fromEnv = envVoiceKey();
  if (fromEnv) return fromEnv;
  return getModelConfigSafe()?.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? null;
}

/** Derive workspace TTS endpoint from OpenAI-compatible chat base URL. */
export function deriveTtsEndpointFromModelBaseUrl(baseUrl: string): string | null {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  const workspaceMatch = normalized.match(
    /^(https:\/\/[^/]+\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com)/,
  );
  if (workspaceMatch) {
    return `${workspaceMatch[1]}/api/v1/services/audio/tts/SpeechSynthesizer`;
  }
  return null;
}

const TTS_PATH_SUFFIX = '/api/v1/services/audio/tts/SpeechSynthesizer';

/** Accept chat base URL pasted by mistake; normalize to CosyVoice synthesizer endpoint. */
export function normalizeVoiceTtsEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return '';

  if (trimmed.includes('/SpeechSynthesizer')) {
    return trimmed.replace(/\/SpeechSynthesizer.*$/, '/SpeechSynthesizer');
  }

  const derived = deriveTtsEndpointFromModelBaseUrl(trimmed);
  if (derived) return derived;

  if (/\.maas\.aliyuncs\.com/i.test(trimmed) && !trimmed.includes('/api/v1/services/audio/tts/')) {
    const origin = trimmed.match(/^(https:\/\/[^/]+\.maas\.aliyuncs\.com)/i)?.[1];
    if (origin) return `${origin}${TTS_PATH_SUFFIX}`;
  }

  return trimmed;
}

export function resolveTtsEndpoint(): string {
  const settings = getVoiceSettings();

  if (!settings.useChatApi) {
    if (settings.voiceTtsEndpoint) return normalizeVoiceTtsEndpoint(settings.voiceTtsEndpoint);
    const fromEnv = envVoiceEndpoint();
    if (fromEnv) return normalizeVoiceTtsEndpoint(fromEnv);
    return 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
  }

  const fromEnv = envVoiceEndpoint();
  if (fromEnv) return fromEnv;

  const modelConfig = getModelConfigSafe();
  if (modelConfig?.baseUrl) {
    const derived = deriveTtsEndpointFromModelBaseUrl(modelConfig.baseUrl);
    if (derived) return derived;
  }

  return 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
}

export function getVoiceApiKeyMasked(): string {
  const settings = getVoiceSettings();
  if (!settings.useChatApi && settings.voiceApiKey) {
    return maskApiKey(settings.voiceApiKey);
  }
  const key = resolveVoiceApiKey();
  return key ? maskApiKey(key) : '';
}

export function isVoiceApiConfigured(): boolean {
  return Boolean(resolveVoiceApiKey());
}
