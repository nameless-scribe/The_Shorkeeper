export type CosyVoiceModel =
  | 'cosyvoice-v3.5-plus'
  | 'cosyvoice-v3.5-flash'
  | 'cosyvoice-v3-plus'
  | 'cosyvoice-v3-flash';

export type VoiceSource = 'preset' | 'cloned';

export type SttLanguage = 'zh' | 'en' | 'auto';

export type PlaybackTarget = 'chat' | 'pet' | 'both';

export interface VoiceSettings {
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  ttsModel: CosyVoiceModel;
  ttsVoiceId: string;
  ttsVoiceSource: VoiceSource;
  activeClonedProfileId: string | null;
  ttsRate: number;
  /** CosyVoice synthesis volume, 0–100 (API default is 50). */
  ttsVolume: number;
  /** Renderer playback gain via Web Audio, 0.5–3. */
  ttsPlaybackGain: number;
  ttsMaxChars: number;
  sttEnabled: boolean;
  sttLanguage: SttLanguage;
  pushToTalk: boolean;
  sttAutoSend: boolean;
  playbackTarget: PlaybackTarget;
  /** true=复用 设置→API 设置的 Key/接入点；false=下方独立百炼语音配置 */
  useChatApi: boolean;
  /** 独立百炼 DashScope Key（useChatApi=false 时使用） */
  voiceApiKey: string;
  /** CosyVoice 合成 endpoint（useChatApi=false 时使用） */
  voiceTtsEndpoint: string;
}

export interface ClonedVoiceProfile {
  id: string;
  name: string;
  voiceId: string;
  targetModel: CosyVoiceModel;
  sampleFilename: string;
  sampleDurationSec: number;
  languageHints: ('zh' | 'en')[];
  createdAt: number;
  lastUsedAt?: number;
}

export interface TtsOptions {
  model: CosyVoiceModel;
  voiceId: string;
  rate: number;
  volume?: number;
  format?: 'mp3' | 'wav';
  languageHint?: 'zh' | 'en';
}

export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
}

export const VOICE_DEFAULTS: VoiceSettings = {
  ttsEnabled: true,
  ttsAutoPlay: false,
  ttsModel: 'cosyvoice-v3.5-plus',
  ttsVoiceId: '',
  ttsVoiceSource: 'cloned',
  activeClonedProfileId: null,
  ttsRate: 1.0,
  ttsVolume: 100,
  ttsPlaybackGain: 2.0,
  ttsMaxChars: 2000,
  sttEnabled: true,
  sttLanguage: 'zh',
  pushToTalk: true,
  sttAutoSend: false,
  playbackTarget: 'chat',
  useChatApi: false,
  voiceApiKey: '',
  voiceTtsEndpoint: '',
};

export const COSYVOICE_MODELS: CosyVoiceModel[] = [
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3-flash',
];
