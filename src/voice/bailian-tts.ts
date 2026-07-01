import { resolveTtsEndpoint, resolveVoiceApiKey } from '../config/voice';
import type { TtsEngine } from './tts-engine';
import type { TtsOptions, TtsResult } from './types';

interface SpeechSynthesizerResponse {
  output?: {
    audio?: {
      data?: string;
      url?: string;
    };
    finish_reason?: string;
  };
  code?: string;
  message?: string;
}

const MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
  opus: 'audio/opus',
};

export class BailianTtsEngine implements TtsEngine {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string, options: TtsOptions): Promise<TtsResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('朗读文本为空');
    }

    const apiKey = resolveVoiceApiKey();
    if (!apiKey) {
      throw new Error('未配置语音 API Key。请在 设置 → API 设置 填写百炼 Key，或设置 VOICE_API_KEY');
    }

    if (!options.voiceId.trim()) {
      throw new Error('未配置音色 ID。请在 设置 → 语音 填入百炼复刻 voice_id');
    }

    const format = options.format ?? 'mp3';
    const endpoint = resolveTtsEndpoint();

    const body = {
      model: options.model,
      input: {
        text: trimmed,
        voice: options.voiceId.trim(),
        format,
        sample_rate: 22050,
        rate: options.rate,
        ...(options.languageHint ? { language_hints: [options.languageHint] } : {}),
      },
    };

    const res = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const rawText = await res.text();
    let json: SpeechSynthesizerResponse & { code?: string; message?: string };
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      const hint =
        endpoint.includes('/compatible-mode/') || endpoint.endsWith('/v1')
          ? ' CosyVoice 合成接入点应填 …/api/v1/services/audio/tts/SpeechSynthesizer，不是对话用的 /compatible-mode/v1。'
          : '';
      throw new Error(
        `语音服务返回非 JSON 响应（HTTP ${res.status}）。${hint}`.trim(),
      );
    }

    if (!res.ok || json.code) {
      const msg = json.message ?? `语音合成失败（HTTP ${res.status}）`;
      if (/invalid api[- ]?key/i.test(msg) || json.code === 'InvalidApiKey') {
        throw new Error(
          '语音 API Key 无效或与接入地址不匹配。请确认 设置 → API 设置 中的百炼 Key 与 Base URL 同属北京地域；或单独设置 VOICE_API_KEY / VOICE_TTS_ENDPOINT',
        );
      }
      throw new Error(msg);
    }

    const audio = json.output?.audio;
    if (!audio) {
      throw new Error(json.message ?? '语音合成未返回音频');
    }

    if (audio.data) {
      const buffer = Buffer.from(audio.data, 'base64');
      return {
        audio: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        mime: MIME_BY_FORMAT[format] ?? 'audio/mpeg',
      };
    }

    if (audio.url) {
      const audioRes = await this.fetchImpl(audio.url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!audioRes.ok) {
        throw new Error(`下载合成音频失败（HTTP ${audioRes.status}）`);
      }
      const arrayBuffer = await audioRes.arrayBuffer();
      const mime = audioRes.headers.get('content-type') ?? MIME_BY_FORMAT[format] ?? 'audio/mpeg';
      return { audio: arrayBuffer, mime };
    }

    throw new Error('语音合成响应缺少音频数据');
  }
}

let defaultEngine: BailianTtsEngine | null = null;

export function getBailianTtsEngine(): BailianTtsEngine {
  if (!defaultEngine) defaultEngine = new BailianTtsEngine();
  return defaultEngine;
}
