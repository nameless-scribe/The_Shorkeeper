import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { resolveTtsWsEndpoint, resolveVoiceApiKey } from '../config/voice';
import { hasSpeakableCharacters, prepareChunkForTts } from './text-for-speech';
import type { SttSocket, SttSocketFactory } from './bailian-stt';
import type { TtsOptions } from './types';

interface TtsWsEvent {
  header?: {
    event?: 'task-started' | 'result-generated' | 'task-finished' | 'task-failed';
    error_code?: string;
    error_message?: string;
  };
}

export interface TtsStreamHandlers {
  onAudioChunk: (audio: ArrayBuffer, seq: number) => void;
  onError: (message: string) => void;
}

export interface TtsStreamSession {
  pushText(sentence: string): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CHUNK_BYTES = 512 * 1024;

function defaultSocketFactory(endpoint: string, apiKey: string): SttSocket {
  const socket = new WebSocket(endpoint, {
    headers: {
      Authorization: `bearer ${apiKey}`,
      'X-DashScope-DataInspection': 'enable',
    },
  });
  return socket as unknown as SttSocket;
}

function bufferToArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (Buffer.isBuffer(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return null;
}

function bufferToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return '';
}

function mapTtsError(message: string, code?: string): Error {
  if (/invalid api[- ]?key/i.test(message) || code === 'InvalidApiKey') {
    return new Error(
      '语音 API Key 无效或与接入地址不匹配。请确认百炼 Key 属北京地域，或单独设置 VOICE_API_KEY',
    );
  }
  return new Error(message);
}

function emitAudioChunks(
  audio: ArrayBuffer,
  seqStart: number,
  onAudioChunk: (audio: ArrayBuffer, seq: number) => void,
): number {
  if (audio.byteLength <= MAX_CHUNK_BYTES) {
    onAudioChunk(audio, seqStart);
    return seqStart + 1;
  }
  const bytes = new Uint8Array(audio);
  let seq = seqStart;
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
    const end = Math.min(offset + MAX_CHUNK_BYTES, bytes.byteLength);
    onAudioChunk(bytes.slice(offset, end).buffer, seq);
    seq += 1;
  }
  return seq;
}

export function createTtsStreamSession(
  options: TtsOptions,
  handlers: TtsStreamHandlers,
  socketFactory: SttSocketFactory = defaultSocketFactory,
): Promise<TtsStreamSession> {
  const apiKey = resolveVoiceApiKey();
  if (!apiKey) {
    return Promise.reject(
      new Error('未配置语音 API Key。请在 设置 → API 设置 填写百炼 Key，或设置 VOICE_API_KEY'),
    );
  }
  if (!options.voiceId.trim()) {
    return Promise.reject(new Error('未配置音色 ID。请在 设置 → 语音 填入百炼复刻 voice_id'));
  }

  const endpoint = resolveTtsWsEndpoint();
  const taskId = randomUUID();
  const socket = socketFactory(endpoint, apiKey);

  let audioSeq = 0;
  let started = false;
  let aborted = false;
  let finished = false;
  let finishRequested = false;
  let startedResolve: (() => void) | null = null;
  let startedReject: ((err: Error) => void) | null = null;
  let finishResolve: (() => void) | null = null;
  let finishReject: ((err: Error) => void) | null = null;

  const startedPromise = new Promise<void>((resolve, reject) => {
    startedResolve = resolve;
    startedReject = reject;
  });

  const finishPromise = new Promise<void>((resolve, reject) => {
    finishResolve = resolve;
    finishReject = reject;
  });
  void finishPromise.catch(() => undefined);

  const timeout = setTimeout(() => {
    fail(new Error('语音合成超时（60s）'));
  }, DEFAULT_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeout);
    try {
      socket.close();
    } catch {
      // ignore
    }
  };

  const fail = (err: Error) => {
    if (aborted || finished) return;
    finished = true;
    cleanup();
    startedReject?.(err);
    startedResolve = null;
    startedReject = null;
    handlers.onError(err.message);
    finishReject?.(err);
    finishResolve = null;
    finishReject = null;
  };

  const complete = () => {
    if (aborted || finished) return;
    finished = true;
    cleanup();
    finishResolve?.();
    finishResolve = null;
    finishReject = null;
  };

  socket.addEventListener('open', () => {
    if (aborted) return;
    try {
      socket.send(
        JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: options.model,
          parameters: {
            text_type: 'PlainText',
            voice: options.voiceId.trim(),
            format: options.format ?? 'mp3',
            sample_rate: 24000,
            volume: options.volume ?? 100,
            rate: options.rate,
            ...(options.languageHint ? { language_hints: [options.languageHint] } : {}),
          },
          input: {},
        },
        }),
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  socket.addEventListener('message', (ev) => {
    if (aborted) return;

    const binary = bufferToArrayBuffer(ev.data);
    if (binary && binary.byteLength > 0) {
      audioSeq = emitAudioChunks(binary, audioSeq, handlers.onAudioChunk);
      return;
    }

    const raw = bufferToString(ev.data);
    if (!raw) return;

    let msg: TtsWsEvent;
    try {
      msg = JSON.parse(raw) as TtsWsEvent;
    } catch {
      return;
    }

    const event = msg.header?.event;
    if (event === 'task-started') {
      started = true;
      startedResolve?.();
      startedResolve = null;
      startedReject = null;
      return;
    }

    if (event === 'task-finished') {
      complete();
      return;
    }

    if (event === 'task-failed') {
      const message = msg.header?.error_message ?? '语音合成失败';
      fail(mapTtsError(message, msg.header?.error_code));
    }
  });

  socket.addEventListener('error', () => {
    if (!aborted && !finished) {
      fail(new Error('语音合成连接错误，请检查网络与百炼语音服务是否开通'));
    }
  });

  socket.addEventListener('close', () => {
    if (aborted || finished) return;
    if (!started) {
      fail(new Error('语音合成连接被关闭，请检查 API Key 与接入地址'));
      return;
    }
    if (finishRequested) {
      complete();
    } else {
      fail(new Error('语音合成连接意外关闭，请重试'));
    }
  });

  const session: TtsStreamSession = {
    async pushText(sentence: string) {
      if (aborted || finished) return;
      await startedPromise;
      const prepared = prepareChunkForTts(sentence);
      if (!prepared || !hasSpeakableCharacters(prepared)) return;
      try {
        socket.send(
          JSON.stringify({
          header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: { text: prepared } },
          }),
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        fail(failure);
        throw failure;
      }
    },

    async finish() {
      if (aborted) return;
      if (finished) {
        await finishPromise;
        return;
      }
      finishRequested = true;
      await startedPromise;
      try {
        socket.send(
          JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
          }),
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        fail(failure);
        throw failure;
      }
      await finishPromise;
    },

    abort() {
      if (aborted) return;
      aborted = true;
      cleanup();
      startedResolve?.();
      startedResolve = null;
      startedReject = null;
      finishResolve?.();
      finishResolve = null;
      finishReject = null;
    },
  };

  return startedPromise.then(() => session);
}
