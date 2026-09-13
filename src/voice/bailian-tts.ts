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

export const MAX_TTS_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_TTS_JSON_BYTES = 30 * 1024 * 1024;

async function readResponseBytesLimited(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<ArrayBuffer> {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // Ignore an already closed response.
    }
    throw new Error(`${label}超过大小限制（${Math.floor(maxBytes / 1024 / 1024)} MB）`);
  }

  if (!response.body) {
    const buffer = typeof response.arrayBuffer === 'function'
      ? await response.arrayBuffer()
      : new TextEncoder().encode(await response.text()).buffer;
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label}超过大小限制（${Math.floor(maxBytes / 1024 / 1024)} MB）`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`${label}超过大小限制（${Math.floor(maxBytes / 1024 / 1024)} MB）`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore an already closed stream.
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore an already released reader.
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export class BailianTtsEngine implements TtsEngine {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(
    text: string,
    options: TtsOptions,
    signal?: AbortSignal,
  ): Promise<TtsResult> {
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
        volume: options.volume ?? 100,
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
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });

    const rawText = new TextDecoder().decode(
      await readResponseBytesLimited(res, MAX_TTS_JSON_BYTES, '语音服务响应'),
    );
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
      if (/input text is valid/i.test(msg)) {
        throw new Error('朗读文本无效或为空，请确认消息中有可朗读的对话内容');
      }
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
      const maxBase64Chars = Math.ceil(MAX_TTS_AUDIO_BYTES / 3) * 4 + 4;
      if (audio.data.length > maxBase64Chars) {
        throw new Error('合成音频超过大小限制（20 MB）');
      }
      const buffer = Buffer.from(audio.data, 'base64');
      if (buffer.byteLength > MAX_TTS_AUDIO_BYTES) {
        throw new Error('合成音频超过大小限制（20 MB）');
      }
      return {
        audio: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        mime: MIME_BY_FORMAT[format] ?? 'audio/mpeg',
      };
    }

    if (audio.url) {
      const audioUrl = new URL(audio.url, endpoint);
      if (audioUrl.protocol !== 'https:' && audioUrl.protocol !== 'http:') {
        throw new Error('语音服务返回了不支持的音频地址');
      }
      const audioRes = await this.fetchImpl(audioUrl, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
      if (!audioRes.ok) {
        throw new Error(`下载合成音频失败（HTTP ${audioRes.status}）`);
      }
      const arrayBuffer = await readResponseBytesLimited(
        audioRes,
        MAX_TTS_AUDIO_BYTES,
        '合成音频',
      );
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
